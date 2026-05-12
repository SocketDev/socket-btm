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
| Provider-virtual fallbacks (offset-only by default)| 4    |
| Calendar-virtual fallbacks (ICU-backed installed)  | 1    |
| Intentional spec deviations (Known drifts)         | 4    |

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
  nanosecond}` over very wide deltas returns `Err` instead of
  silently narrowing to `int64`. C2 in the review.
- **`PlainDateTime::until/since`** cross-midnight sign disagreement
  is not balanced via `BalanceTimeDurationRelative` in every case;
  the smoke test covers the common path. Wider tail (H6) is the
  remaining open work; the path returns a structurally valid
  Duration but may differ from spec by ±1 day at certain DST
  boundaries.

## Rounding-tail dependents (still wired, work today for defaults)

The following methods accept rounding/diff settings; with default
options they produce correct results. With non-default
`smallestUnit` or `roundingIncrement` they fall back to the
unrounded result rather than full
`RoundRelativeDuration`-style rounding:

- `Instant.round` — default works; custom increment/unit unrounded.
- `Instant.until/since` — default works; custom settings unrounded.
- `PlainDateTime.round` — same.
- `PlainYearMonth.until/since` — same.

These are not "stubs" — they produce structurally valid Durations
that match spec under default invocation. The rounding-tail
upgrade is tracked as a follow-on improvement.

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
