# temporal-infra lockstep tracker

Single source of truth for every method in the
`packages/temporal-infra/` C++ port relative to upstream
`temporal_rs`. The port is now functionally 1:1 with upstream for
every JS-visible Temporal entry point. Provider-dependent paths
(IANA TZDB lookups) work end-to-end for offset-only zones and
delegate to the registered `TimeZoneBackend` virtual for IANA
zones; V8's IANA layer can install a real backend at boot. Non-ISO
calendar paths route through the registered `CalendarBackend`
virtual; the package ships an ICU-backed override
(`IcuCalendarBackend`) that V8 installs by default.

Audit by re-running:

```bash
rg -n "not yet implemented|requires calendar|requires a calendar" \
   packages/temporal-infra/include packages/temporal-infra/src \
   | grep -v upstream
```

Should return only doc-comments — no live error returns. New
intentional stubs must add a row to this tracker.

## Snapshot

| Status                                            | Count |
| ------------------------------------------------- | ----- |
| JS-visible methods with real bodies               | All   |
| `NotImplemented` returns at runtime               | 0     |
| Provider-virtual fallbacks (offset-only by default)| 0    |
| Calendar-virtual fallbacks (ICU-backed installed)  | 0    |
| Intentional spec deviations (Known drifts)         | 3    |

## Backends

### `TimeZoneBackend`
- Default implementation lives in `time_zone.cc` and handles
  offset-only zones (`+05:00`, `Z`, …) inline via the offset arithmetic
  helpers.
- IANA zones go through the `GetIsoDateTimeFor` /
  `GetEpochNanosecondsFor` virtuals. The package ships
  `IcuTimeZoneBackend` (icu_tz_backend.cc) which routes to
  `icu::BasicTimeZone::getOffsetFromLocal` with `kFormer` / `kLatter`
  selectors for ambiguous wall-clock resolution. V8 installs this
  backend at boot when `V8_INTL_SUPPORT` is on.

### `CalendarBackend`
- Default implementation in `calendar.cc` handles ISO 8601 inline
  (the proleptic Gregorian calendar in the spec's terms).
- Non-ISO calendars route through 10 virtuals: `DateAdd`,
  `DateUntil`, `DaysInMonth`, `DaysInYear`, `MonthsInYear`,
  `DaysInWeek`, `MonthCode`, `Era`, `EraYear`, `InLeapYear`. The
  package ships `IcuCalendarBackend` (icu_cal_backend.cc) which
  routes through `icu::Calendar::createInstance("@calendar=...")`
  for every kind in `CalendarKind` (Buddhist, Chinese, Coptic,
  Dangi, Ethiopian, Ethiopian-Amete-Alem, Gregorian, Hebrew, Indian,
  Hijri Tabular Friday / Thursday, Hijri Umm-al-Qura, Japanese,
  Persian, ROC).

## Inner-POD CalendarKind threading

`PlainDate`, `PlainDateTime`, `PlainMonthDay`, and `PlainYearMonth`
inner PODs now carry a `CalendarKind` field (uint8_t enum, defined
in `temporal.h` so the PODs can hold it without a header cycle).
The compat shim factories thread `AnyCalendarKind` into the produced
POD, every calendar-aware accessor reads from `inner_.calendar`, and
`PlainDateFromUtf8` / `PlainDateTimeFromUtf8` propagate the
`[u-ca=...]` IXDTF annotation. `ZonedDateTime` continues to hold a
full `Calendar` wrapper.

## Known drifts (intentional, not stubs)

These are documented spec/upstream divergences. None should ever
return `NotImplemented` at runtime.

- **`FormattableMonthDay::WriteTo`** emits the `--` prefix that
  upstream `temporal_rs` omits but the JS Temporal spec requires
  (commit `240affe4`).
- **`TemporalError` storage** owns `std::string` with rebinding
  copy/move constructors instead of the upstream `&'static str`
  / `String` enum — ABI constraint at the V8 boundary.
- **`Instant::until/since`** with `largestUnit ∈ {microsecond,
  nanosecond}` over deltas exceeding `int64` capacity returns
  `Err("delta exceeds int64 ... at the requested largestUnit")`
  instead of silently narrowing to f64 (which would lose
  precision past `Number.MAX_SAFE_INTEGER`). Upstream returns
  the narrowed f64 — the spec accepts both behaviors. Our impl
  refuses rather than misreport. Surfaces at: deltas >
  `2^63 / 1000` µs ≈ 292 years for `microsecond` largestUnit; >
  `2^63` ns ≈ 292 years for `nanosecond` largestUnit. Within the
  ±10^8-day Instant range it's possible to hit this — V8 callers
  who genuinely need wide deltas should use `millisecond` or
  larger. See `Instant.hpp:475-493`.
- **`duration_normalized.cc:322` DoubleDouble approximation.**
  Time-only duration ↔ f64 conversion uses a conservative
  range-bound check rather than the full DoubleDouble decomposition
  upstream uses. Affects time-only durations beyond ±285 years
  (`Number.MAX_SAFE_INTEGER` nanoseconds); within spec-valid
  Duration ranges (which the validate-on-construction guard
  enforces), the behavior is bit-identical to upstream.

## Rounding tail

All rounding-tail consumers route through `IncrementRounder<T>` /
the open-coded Int128 rounder in the affected methods:

- `Instant.round` — full custom unit/increment/mode coverage.
- `Instant.until/since` — full coverage including largestUnit guards.
- `PlainDateTime.round` — full coverage via `RoundIsoDateTime`.
- `PlainYearMonth.until/since` — months-delta rounded via
  `IncrementRounder<int64_t>`, year/month carry preserved per
  largestUnit.

No method falls through to "return unrounded" today.

## monthCode resolution

`Calendar::resolve_month_code(year, code)` is implemented in
`calendar.cc:CalendarResolveMonthCode` with the ICU backend
providing the year-dependent leap variant for Hebrew / Chinese /
Dangi calendars (the only TC39-Temporal calendars with leap
months). All other calendars use a direct M01..M12/13 → 1..12/13
mapping. `PlainMonthDay.from`, `PlainMonthDay.with`,
`PlainYearMonth.from`, and `PlainYearMonth.with` accept
monthCode-only partial inputs.

## Audit checklist

When adding a new stub or finding a real `NotImplemented`:

1. Confirm the gap is real (run the audit `rg` from the header).
2. Add a row below describing the JS-visible name, C++ surface,
   upstream Rust pointer, and the prereq.
3. Match every row with a smoke-test case in
   `packages/build-infra/test/fixtures/smoke-test-temporal.mjs`
   that exercises a non-trivial input.

## See also

- Upstream Rust source: `packages/temporal-infra/upstream/temporal/src/`
- V8 caller: `packages/node-smol-builder/upstream/node/deps/v8/src/objects/js-temporal-objects.cc`
- ICU TimeZone backend: `packages/temporal-infra/src/socketsecurity/temporal/icu_tz_backend.{h,cc}`
- ICU Calendar backend: `packages/temporal-infra/src/socketsecurity/temporal/icu_cal_backend.{h,cc}`
- Smoke test: `packages/build-infra/test/fixtures/smoke-test-temporal.mjs`
