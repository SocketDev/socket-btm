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
| Intentional spec deviations (Known drifts)            | 3      |

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
`NotImplemented` at runtime.

1. **`FormattableMonthDay::WriteTo`** emits the `--` prefix
   required by the JS Temporal spec (upstream `temporal_rs` omits
   it; commit `240affe4`).
2. **`TemporalError` storage** owns `std::string` with rebinding
   copy/move constructors instead of the upstream `&'static str` /
   `String` enum (ABI constraint at the V8 boundary).
3. **`Instant::until/since`** with `largestUnit ∈ {microsecond,
   nanosecond}` over deltas exceeding `int64` capacity returns
   `Err("delta exceeds int64 ... at the requested largestUnit")`
   rather than silently narrowing to f64. Spec accepts either
   behavior. Threshold: ≈292 years for `microsecond` largestUnit;
   ≈292 years for `nanosecond` largestUnit. V8 callers needing
   wider deltas use `millisecond` or larger. See
   `Instant.hpp:475-493`.
4. **`duration_normalized.cc:322` DoubleDouble approximation.**
   Time-only duration ↔ f64 uses a conservative bound check rather
   than upstream's full DoubleDouble decomposition. Only matters
   for time-only durations beyond ±285 years
   (`Number.MAX_SAFE_INTEGER` nanoseconds). Spec-valid Duration
   ranges (enforced by `IsValidDuration` on construction) are
   bit-identical to upstream.

## Audit script

Run `pnpm exec tsx packages/temporal-infra/scripts/check-lockstep.mts`
(or via the root `pnpm check` alias). Three checks:

1. **Live stub scan.** Greps source for "not yet implemented" /
   "requires calendar" / "Stub:" patterns. Any hit fails the check.
2. **V8 call-site cross-check.** Walks
   `packages/node-smol-builder/upstream/node/deps/v8/src/objects/js-temporal-objects.cc`
   for `temporal_rs::*::method` references; confirms every one has
   a non-stub body in the corresponding shim header.
3. **Smoke-test gate.** Compiles + runs the smoke test against the
   built node-smol binary; passes only if all assertions pass.

A passing audit run is the lockstep gate.

## See also

- Upstream Rust source: `packages/temporal-infra/upstream/temporal/src/`
- V8 caller: `packages/node-smol-builder/upstream/node/deps/v8/src/objects/js-temporal-objects.cc`
- ICU TimeZone backend: `packages/temporal-infra/src/socketsecurity/temporal/icu_tz_backend.{h,cc}`
- ICU Calendar backend: `packages/temporal-infra/src/socketsecurity/temporal/icu_cal_backend.{h,cc}`
- Smoke test: `packages/build-infra/test/fixtures/smoke-test-temporal.mjs`
- Test262 runner: `packages/temporal-infra/test/test262/`
