# temporal_rs compatibility shim

This directory provides drop-in replacement headers for the diplomat-generated
bindings shipped with the `temporal_rs` Rust crate at
`deps/crates/vendor/temporal_capi/bindings/cpp/temporal_rs/`. V8's
`js-temporal-objects.cc` (~7142 LOC, ~459 call sites) `#include`s those
headers; pointing the gyp `include_dirs` here instead lets V8 compile against
our temporal-infra C++ port and drop the rustc/cargo build dependency.

## Why the `temporal_rs` name (no Rust here)

There's no Rust in this layer — the headers are 100% hand-written C++ that
delegate to `node::socketsecurity::temporal::` (our idiomatic C++ port at
`packages/temporal-infra/src/socketsecurity/temporal/`). No FFI, no diplomat
runtime, no `cargo` invocation anywhere in the build chain.

The `temporal_rs::` namespace is preserved as the **ABI surface V8 expects** —
upstream V8's `js-temporal-objects.cc` hard-codes `temporal_rs::Instant`,
`temporal_rs::PlainDate`, etc. across ~459 call sites. Renaming would mean
forking that file or carrying a ~459-line patch on every V8 rebase. Keeping
the name keeps the patch surface minimal: one gyp include-path flip + a few
configure.py / Dockerfile cleanups (patches 037, 038).

So read `temporal_rs::` here as "the V8-facing adapter shape, named after
the diplomat layout V8 was generated against" — not "the Rust crate." The
two-namespace separation is structural: `socketsecurity::temporal::PlainDate`
is a POD value type used by the algorithm port; `temporal_rs::PlainDate` is
the heap-owned diplomat-shaped class V8 calls. Different shapes by design.

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

**Phase 10d — heavyweights + arithmetic activation:**

- `Duration.hpp` — try_new / create / from_partial / from_utf8 / from_utf16 +
  abs / negated / add / subtract / round / total / compare / to_string +
  10 field accessors + sign / is_zero / is_time_within_range + ToInfra/FromInfra
  bridges
- `PartialDuration.hpp` — optional-fields struct
- `Calendar.hpp` — create / create_iso / try_from_utf8 + kind / identifier /
  is_iso / equals / clone + bridges
- `TimeZone.hpp` — utc / from_offset_seconds / try_from_identifier_str /
  try_from_str + identifier / is_offset / clone + bridges
- `ZonedDateTime.hpp` — try_new / from_utf8 / from_utf16 + 9 accessors +
  to_instant / to_plain_date_time / to_plain_date / to_plain_time +
  compare_instant / equals / clone + bridges
- `RelativeTo.hpp` / `OwnedRelativeTo.hpp` — borrow / owned variants of the
  PlainDate ⊎ ZonedDateTime tagged union for Duration arithmetic anchors
- `Provider.hpp` — TzdbProvider handle (compiled / fs)
- `ArithmeticOverflow.hpp` — enum (Constrain / Reject)
- `ParsedDate.hpp` / `ParsedDateTime.hpp` / `ParsedZonedDateTime.hpp` —
  parsed-but-not-validated structs from the IXDTF parser
- `PartialZonedDateTime.hpp` — optional-fields struct with date / time /
  time_zone / offset / calendar / disambiguation / offset_option

Plus the Phase 10c.5 activation:

- `PlainDate.hpp` — `add` / `subtract` / `since` / `until` (templated on
  Duration / DifferenceSettings shims to break the include cycle)
- `PlainDateTime.hpp` — `add` / `subtract` / `since` / `until` + `to_plain_date` / `to_plain_time`
- `PlainTime.hpp` — `add` / `subtract` / `since` / `until` / `round`
- `PlainYearMonth.hpp` — `equals` / `compare`
- `PlainMonthDay.hpp` — `equals` / `compare`
- `Instant.hpp` — `add` / `subtract` / `since` / `until` (wired through
  `AddDuration` + `InstantSince`); ToInfra / FromInfra bridges

## Status: 100% covered

Every type V8 references (37/37) has a shim file; every method on each shim
either dispatches to a temporal-infra free function or computes the result
inline. No TODO comments, no stub-returning bodies — the C++ port is the only
backing layer.

The Duration parser/formatter (`DurationFromUtf8` / `DurationToString`) and
the time-only `DurationCompare` / `DurationTotalNanoseconds` helpers landed
in `src/socketsecurity/temporal/duration.cc` as part of this phase.

## Wiring (Phase 10e — flip the include path)

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
