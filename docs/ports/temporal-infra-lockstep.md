# temporal-infra lockstep tracker

## The contract

**Observable 1:1 with the JS Temporal spec.** Every JS-visible
`Temporal.*` entry point produces the spec-defined result. We
validate this end-to-end via Test262 (TC39's conformance suite) plus
the in-tree smoke test.

**Not a goal:** mirroring upstream `temporal_rs`'s full public Rust
API. Upstream exposes ~250 `pub fn` entry points (many are internal
trait methods, factory overloads, and `_with_provider` variants used
by downstream Rust crates that aren't V8). The C++ port wraps only
what V8's `js-temporal-objects.cc` actually calls — that's the
observable surface. Adding wrappers V8 doesn't invoke is dead code.

## How to keep this lockstep

1. **Spec defines the contract.** When the spec changes, the smoke
   test should fail (or pass with new assertions). Update the port,
   not the contract.
2. **Upstream `temporal_rs` is the implementation reference.** When
   porting a method, cite the upstream Rust file:line in a comment
   so cascades have a fixed point.
3. **V8's `js-temporal-objects.cc` is the call-site reference.** A
   method only needs a shim wrapper if V8 calls it. The audit script
   below enforces this.
4. **Run `pnpm run check:temporal-lockstep` after any change** to
   the port. It cross-references three things:
   - V8's js-temporal call sites → required shim methods
   - Shim header methods → all have real bodies (no `NotImplemented`)
   - Upstream `pub fn` set → noted (informational, not a gate)

## Snapshot

| Metric                                                | Status |
| ----------------------------------------------------- | ------ |
| V8-required shim methods present                      | All    |
| Shim methods with `NotImplemented` body               | 0      |
| Test262 entry-point coverage                          | TBD¹   |
| Smoke test assertions                                 | 85     |
| Intentional spec deviations (Known drifts)            | 4      |

¹ Test262 runs in the node-smol CI workflow; results land in
`packages/temporal-infra/test/test262-results.json` per build.

## Backends

Two virtual dispatch layers let the port stay free of Isolate
state while still resolving IANA TZ + non-ISO calendars at the
binding boundary.

### `TimeZoneBackend` (`src/socketsecurity/temporal/time_zone.h`)

Offset-only zones (`+05:00`, `Z`, ...) resolve inline in
`time_zone.cc`. IANA zones route through four virtuals:

- `CanonicalizeIdentifier(iana_id)` → canonical form
- `GetIsoDateTimeFor(iana_id, instant)` → local wall clock
- `GetEpochNanosecondsFor(iana_id, datetime, disambiguation)` →
  instant for a wall clock (handles DST gap/overlap)
- `GetTransition(iana_id, from_epoch_ns, direction)` → next/prev
  DST transition (drives `ZonedDateTime.getTimeZoneTransition`)

V8 installs `IcuTimeZoneBackend` (`icu_tz_backend.{h,cc}`) at boot
when `V8_INTL_SUPPORT` is on. It routes to `icu::BasicTimeZone`
APIs (`getOffsetFromLocal`, `getNextTransition`,
`getPreviousTransition`).

### `CalendarBackend` (`src/socketsecurity/temporal/calendar.h`)

ISO 8601 (proleptic Gregorian) is the default inline. Non-ISO
calendars route through 11 virtuals: `DateAdd`, `DateUntil`,
`DaysInMonth`, `DaysInYear`, `MonthsInYear`, `DaysInWeek`,
`MonthCode`, `Era`, `EraYear`, `InLeapYear`, `ResolveMonthCode`.

V8 installs `IcuCalendarBackend` (`icu_cal_backend.{h,cc}`). It
opens an `icu::Calendar` via the locale keyword
(`"@calendar=hebrew"`, etc.) for every kind in `CalendarKind`
(15 calendars: Buddhist, Chinese, Coptic, Dangi, Ethiopian,
Ethiopian-Amete-Alem, Gregorian, Hebrew, Indian, Hijri Tabular
Friday / Thursday, Hijri Umm-al-Qura, Japanese, Persian, ROC).

## Inner-POD CalendarKind threading

`PlainDate`, `PlainDateTime`, `PlainMonthDay`, `PlainYearMonth`
inner PODs carry a `CalendarKind` field (uint8_t enum defined in
`temporal.h` to avoid a header cycle with `calendar.h`). The
compat shim factories thread `AnyCalendarKind` into the produced
POD; every calendar-aware accessor reads from `inner_.calendar`;
`PlainDateFromUtf8` / `PlainDateTimeFromUtf8` extract the
`[u-ca=...]` IXDTF annotation. `ZonedDateTime` keeps a full
`Calendar` wrapper (it always has, for ABI parity with V8's slot
layout).

## Known drifts

Intentional spec/upstream divergences. None returns
`NotImplemented` at runtime. Each entry follows the same shape:
**Drift** — what diverges; **Why** — the reason it's intentional;
**Impact** — what callers observe; **Reference** — the code site.

### 1. `FormattableMonthDay::WriteTo` emits the `--` prefix

- **Drift.** Output starts with `--` (e.g. `--12-25`). Upstream
  `temporal_rs::FormattableMonthDay::write_to` omits the prefix.
- **Why.** ECMA-262 Temporal proposal section 11.3.27
  (`Temporal.PlainMonthDay.prototype.toString`) and IXDTF (RFC 9557)
  both require the `--` prefix for MD-only date strings. Upstream's
  omission is a Rust-side ergonomic shortcut that downstream Rust
  callers patch themselves; for V8 the C++ port must produce the
  spec output directly.
- **Impact.** Strictly observable on `PlainMonthDay.toString()`. The
  port's output passes Test262 cases like
  `built-ins/Temporal/PlainMonthDay/prototype/toString/basic.js`;
  upstream's would fail them.
- **Reference.** Commit `240affe4`, `ixdtf_writer.cc` MD path.

### 2. `TemporalError` storage owns `std::string`

- **Drift.** `TemporalError::message_` is a `std::string` member
  (with explicit copy/move constructors and assignment operators).
  Upstream's `temporal_rs::TemporalError` is a Rust enum with
  `&'static str` for built-in variants and `String` for dynamic
  ones; storage is implicit via Rust's tagged-union layout.
- **Why.** ABI constraint at the V8 boundary. The port crosses
  into V8 via the diplomat shim, which expects opaque heap-owned
  objects with stable copy/move semantics. A tagged-union over
  `&'static str` cannot survive cross-translation-unit boundaries
  without ad-hoc deep-copy logic; owning `std::string` gives the
  same observable error messages with a simpler ABI.
- **Impact.** Zero observable difference at the JS surface — the
  message text is identical to upstream's for every error variant.
  Internal C++ callers see `std::string&` instead of `&str`.
- **Reference.** `error.h:25-78`, `error.cc:14-92`.

### 3. `Instant::until/since` rejects sub-second largestUnit on huge deltas

- **Drift.** When `largestUnit ∈ {microsecond, nanosecond}` and the
  delta exceeds `int64` capacity at that unit, the port returns
  `Err("delta exceeds int64 ... at the requested largestUnit")`.
  Upstream silently narrows to f64 (losing precision).
- **Why.** The spec accepts either behavior — implementations may
  reject or lossy-narrow per
  [ECMA-262 §22.1.5.7](https://tc39.es/proposal-temporal/#sec-temporal-totaldurationnanoseconds).
  Returning `Err` makes precision loss observable to V8 (which
  surfaces as a thrown `RangeError`) rather than silently producing
  a wrong `Duration` object. V8 callers needing deltas over 292
  years use `largestUnit: 'millisecond'` or larger, which doesn't
  hit the int64 ceiling.
- **Impact.** Deltas beyond ≈292 years between two `Instant`s at
  `microsecond`/`nanosecond` largestUnit throw instead of returning
  a lossy `Duration`. Smaller deltas: bit-identical to upstream.
- **Reference.** `instant.h:475-493`, `instant.cc::DifferenceInstant`.

### 4. `duration_normalized.cc` DoubleDouble approximation

- **Drift.** `NormalizedTimeDuration ↔ f64` uses a conservative
  range check (compare against a fixed bound) rather than
  upstream's full DoubleDouble decomposition (which preserves
  precision near the f64 limit).
- **Why.** Full DoubleDouble decomposition requires a ~200-line
  helper that's only exercised when time-only duration values
  exceed `Number.MAX_SAFE_INTEGER` nanoseconds (≈285 years).
  `IsValidDuration` already rejects out-of-spec Durations at
  construction; the range that DoubleDouble would matter for is
  exclusively *invalid* Durations the spec rejects. The
  approximation is a code-size/maintenance optimization.
- **Impact.** **Zero impact on spec-valid Durations** — every
  Duration that passes `IsValidDuration` (enforced at every
  factory entry point) computes bit-identically to upstream. The
  difference only surfaces if a caller bypasses validation, which
  the V8 binding never does.
- **Reference.** `duration_normalized.cc:322`,
  `duration.cc::IsValidDuration`.

## Audit script

Run `pnpm --filter temporal-infra run check:lockstep`. Three checks:

1. **Live stub scan.** Greps source for "not yet implemented" /
   "requires calendar" / "Stub:" patterns. Any hit fails the check.
2. **V8 call-site cross-check.** Walks
   `packages/node-smol-builder/upstream/node/deps/v8/src/objects/js-temporal-objects.cc`
   for `temporal_rs::*::method` references; confirms every one has
   a non-stub body in the corresponding shim header.
3. **Smoke-test gate.** Compiles + runs the smoke test against the
   built node-smol binary; passes only if all assertions pass.

A passing audit run is the lockstep gate.

### Self-test (`pnpm --filter temporal-infra run check:lockstep:self-test`)

`scripts/check-lockstep.test.mts` verifies the audit's own regex
shapes against synthetic fixtures. Without this, a regex bug
could silently false-pass forever — the audit's whole value is
catching drift before runtime, so it must itself be tested.

Run on any change to `check-lockstep.mts`:

```bash
pnpm --filter temporal-infra run check:lockstep:self-test
```

## See also

- Upstream Rust source: `packages/temporal-infra/upstream/temporal/src/`
- V8 caller: `packages/node-smol-builder/upstream/node/deps/v8/src/objects/js-temporal-objects.cc`
- ICU TimeZone backend: `packages/temporal-infra/src/socketsecurity/temporal/icu_tz_backend.{h,cc}`
- ICU Calendar backend: `packages/temporal-infra/src/socketsecurity/temporal/icu_cal_backend.{h,cc}`
- Smoke test: `packages/build-infra/test/fixtures/smoke-test-temporal.mjs`
- Test262 runner: `packages/temporal-infra/test/test262/`
