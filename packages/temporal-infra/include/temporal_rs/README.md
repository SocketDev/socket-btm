# temporal_rs compatibility shim

This directory provides drop-in replacement headers for the diplomat-generated
bindings shipped with the `temporal_rs` Rust crate at
`deps/crates/vendor/temporal_capi/bindings/cpp/temporal_rs/`. V8's
`js-temporal-objects.cc` (~7142 LOC, ~459 call sites) `#include`s those
headers; pointing the gyp `include_dirs` here instead lets V8 compile against
our temporal-infra C++ port and drop the rustc/cargo build dependency.

## Status

**Phase 10a — foundation:**

- `diplomat_runtime.hpp` — `Ok` / `Err` / `result<T, E>` template, `span<T>`
- `ErrorKind.hpp` — enum-class shim mapping to `node::socketsecurity::temporal::ErrorKind`
- `TemporalError.hpp` — struct with `kind` + `msg` accessor
- `I128Nanoseconds.hpp` — `{high, low}` shim with `ToInfra()` / `FromInfra()` bridges
- `Instant.hpp` — heap-owned wrapper class, factories + accessors + clone

**Phase 10b — enums + small structs:**

- `AnyCalendarKind.hpp` — calendar enum + `get_for_str` / `parse_temporal_calendar_string` static methods, full bridge to `CalendarKind`
- `Disambiguation.hpp` — Compatible / Earlier / Later / Reject
- `OffsetDisambiguation.hpp` — Use / Prefer / Ignore / Reject
- `RoundingMode.hpp` — 9 modes (Ceil through HalfEven)
- `Sign.hpp` — Negative=-1 / Zero=0 / Positive=1
- `Unit.hpp` — Auto=0 through Year=10 (numeric values match upstream)
- `DisplayCalendar.hpp` / `DisplayOffset.hpp` / `DisplayTimeZone.hpp` — toString display options
- `TransitionDirection.hpp` — Next / Previous (DST transition lookup)
- `Precision.hpp` — Auto / Minute / Digit(n) tri-state struct

**Phase 10c — Plain* heap-owned wrappers:**

- `PartialDate.hpp` / `PartialTime.hpp` / `PartialDateTime.hpp` — optional-fields structs
- `PlainDate.hpp` — try_new / from_partial / from_utf8 / from_utf16 / with / equals / compare / clone + 9 field accessors (year/month/day/dayOfWeek/dayOfYear/weekOfYear/daysInMonth/daysInYear/inLeapYear)
- `PlainTime.hpp` — same factories pattern + 6 time accessors
- `PlainDateTime.hpp` — same + 9 accessors
- `PlainYearMonth.hpp` — try_new_iso / from_utf8 / from_utf16 + accessors
- `PlainMonthDay.hpp` — try_new_iso / from_utf8 / from_utf16 + accessors

## What's NOT yet ported (Phase 10d+)

Remaining types V8 references:

| Type | Use count | Notes |
|---|---|---|
| ArithmeticOverflow | 38 | enum-class, trivial |
| ZonedDateTime | 30 | wraps Instant + TimeZone + Calendar |
| AnyCalendarKind | 29 | enum, maps to our CalendarKind |
| TimeZone | 28 | non-trivial; depends on V8 zoneinfo64 backend |
| PlainDate | 25 | calendar wrapper |
| PartialDate | 24 | optional-fields struct |
| PlainTime | 23 | wraps IsoTime |
| DisplayCalendar | 23 | enum |
| ParsedDate | 18 | wraps our ParsedDate |
| Duration | 16 | full arithmetic surface |
| PlainDateTime | 15 | wraps PlainDate + PlainTime |
| Disambiguation | 15 | enum |
| OffsetDisambiguation | 14 | enum |
| PartialTime | 13 | optional-fields struct |
| PartialDateTime | 12 | nested partial |
| PlainYearMonth | 11 | calendar wrapper |
| PartialZonedDateTime | 11 | partial for ZDT |
| Precision | 9 | enum |
| DisplayTimeZone | 9 | enum |
| TransitionDirection | 7 | enum |
| ToStringRoundingOptions | 7 | options struct |
| OwnedRelativeTo | 7 | tagged union |
| PlainMonthDay | 6 | calendar wrapper |
| RoundingMode | (counted within RoundingOptions) | enum |
| RoundingOptions | n/a | options struct |
| Sign | n/a | enum |
| Provider | n/a | TimeZoneBackend handle |
| RelativeTo | n/a | borrow-flavor of OwnedRelativeTo |
| ParsedDateTime | n/a | wraps our ParsedDateTime |
| ParsedZonedDateTime | n/a | needs ZDT |
| PartialDuration | n/a | optional-fields |

Plus: each non-trivial type needs all its diplomat methods bridged. `Instant`
alone has ~15 methods (try_new + from_epoch_ms + from_utf8/16 + add + subtract
+ since + until + round + compare + equals + epoch_ms + epoch_ns +
to_ixdtf_string + to_zoned_date_time_iso + clone).

## Wiring (when Phase 10 finishes)

1. Edit `packages/node-smol-builder/scripts/binary-released/shared/prepare-external-sources.mts` to copy `packages/temporal-infra/include/temporal_rs/` into the libnode build at `additions/source-patched/include/temporal_rs/` (next to existing `temporal/`).
2. Edit `packages/node-smol-builder/patches/source-patched/004-node-gyp-smol-sources.patch` to put `include/temporal_rs` at the front of the V8-target `include_dirs` (so it wins over `deps/crates/vendor/temporal_capi/bindings/cpp/`).
3. Drop the `temporal_capi` / `temporal_rs` Rust deps from `deps/crates/Cargo.toml`. Drop the `node_use_rust` gyp variable. Drop the rustc/cargo postinstall hook.
4. Bump `node-smol` cache version. Dispatch dry-run; verify Temporal smoke test.

That's all — point the include path, drop the Rust dep, ship.

## Why two layers (compat shim + temporal-infra)?

- `socketsecurity/temporal/` (temporal-infra) — the spec-faithful, idiomatic C++
  port of upstream's algorithms. Owned by us, evolves independently.
- `temporal_rs/` (this dir) — diplomat-shaped façade so V8 doesn't need to
  change. Thin and mechanical: parameter shape transformations, ownership
  bridging, `result<unique_ptr<T>, TemporalError>` → our value-type results.

The shim layer is intentionally write-once, throw-away if V8 ever migrates off
diplomat (or if a future V8 redesign exposes a different binding surface).
temporal-infra is the long-term asset.
