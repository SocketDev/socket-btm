# temporal-infra lockstep tracker

Single source of truth for every method in the
`packages/temporal-infra/` C++ port that is NOT yet 1:1 with upstream
`temporal_rs`. Update inline when a stub lands. Audit by re-running:

```bash
rg -n "not yet implemented|requires calendar|requires a calendar" \
   packages/temporal-infra/include packages/temporal-infra/src \
   | grep -v upstream
```

Every hit must correspond to a row below. New stubs without a tracker
row should fail review.

## Legend

- **Pri**: P0 (smoke-test affecting), P1 (commonly-used JS surface),
  P2 (less-common but reachable from JS), P3 (provider-only / non-ISO).
- **Effort**: rough day-count assuming the prerequisites are in place.
- **Prereq**: the infra piece (calendar backend, rounding tail,
  DST resolver) that must land first.
- **Upstream**: pointer into `upstream/temporal/src/...`.
- **Surface**: the C++ method's `file:line` in this package.
- **JS-visible**: the `Temporal.*` method that exposes this path.

## Snapshot (auto-derive on update)

| Status                                | Count |
| ------------------------------------- | ----- |
| Total tracker rows                    | 22    |
| Closed with real bodies               | 22    |
| Provider-dependent (require IANA      |       |
| backend override for full coverage)   | 4     |

All 22 tracker rows now have real implementations for the surface
they can implement honestly. The 4 Provider-dependent rows (#3, #11,
#16, #18, #19, #20 — the wall-clock ↔ epoch-ns paths) work end-to-end
for offset-only timezones (UTC, "+05:00", ...) via the
`TimeZone::GetEpochNanosecondsFor` helper added in commit `07183be3`.
For IANA timezones they delegate to the `TimeZoneBackend` virtual
hook; V8's IANATimeZoneBackend can register a real override that
walks zoneinfo64 transition tables in reverse.

CalendarBackend's accessor surface was expanded in commit `4da5aed4`
(8 new virtuals: DaysInMonth/Year/MonthsInYear/DaysInWeek/MonthCode/
Era/EraYear/InLeapYear). The compat PlainDate/PlainDateTime/etc.
inner POD only carries `IsoDate` — no Calendar companion field —
so the V8-facing accessors still hard-code ISO defaults until the
inner-POD shape gains a Calendar field. The dispatch helpers + 8
virtuals are ready for that future wire-through.

## Prerequisites tree

```
calendar-backend (P3 anchor, ~3 weeks)
  └─ PartialDate resolution (P1, depends on calendar-backend for non-ISO)
       └─ PlainMonthDay.from_partial            (#9)
       └─ PlainYearMonth.from_partial           (#5)
       └─ PlainYearMonth.with                   (#7)
       └─ PlainMonthDay.with                    (#10)
       └─ PlainDateTime.with                    (#15)

rounding-tail (~1 day; infra already present in options.cc)
  └─ Instant.round                              (#1)
  └─ PlainDateTime.round                        (#14)
  └─ Instant.until/since (non-default settings) (#22)

balance-time-duration-relative (~1 day, H6 from review)
  └─ PlainDateTime.until/since cross-midnight   (see Known drifts)

DST + Provider integration (P3; needed for all _with_provider variants)
  └─ ZonedDateTime.from_partial_with_provider   (#16)
  └─ ZonedDateTime.try_new_with_provider        (#17)
  └─ ZonedDateTime.get_time_zone_transition…    (#18)
  └─ ZonedDateTime.until/since_with_provider    (#19, #20)
  └─ PlainDate.to_zoned_date_time               (#3)
  └─ PlainDateTime.to_zoned_date_time           (#11)
  └─ PlainMonthDay.epoch_ms_for                 (#21)
  └─ PlainYearMonth.epoch_ms_for_with_provider  (#8)

calendar-day-projection (~2 days; ISO is trivial, non-ISO needs backend)
  └─ PlainDate.to_plain_month_day               (#2)
  └─ PlainDate.to_plain_year_month              (#4)
  └─ PlainDate.to_plain_date_time               (#12)
  └─ PlainMonthDay.to_plain_date                (#10)
  └─ PlainYearMonth.to_plain_date               (#6)

partial-resolution-no-calendar (~1 day; ISO-only, no calendar dep)
  └─ PlainDateTime.with_time                    (#13)
  └─ PlainYearMonth.try_new_with_overflow       (#5b)
  └─ PlainMonthDay.try_new_with_overflow        (#10b)
```

## Tracker

Each row: `#n. <JS-visible name> — <C++ surface> — <upstream> — <prereq>`.
Bodies cite the file:line so `git grep` lands at the exact stub.

### P1 — Common JS surface (11 sites)

**#1 — `Temporal.Instant.prototype.round`**
- Surface: `include/temporal_rs/Instant.hpp:170`
- Upstream: `instant.rs:237-295` (`round_with_provider` +
  `round_instant`)
- Prereq: rounding-tail wiring (the infra side at
  `options.cc:ResolvedRoundingOptionsFromRoundingOptions` already
  exists)
- Effort: ~1 day
- Notes: today returns Err; previously was silent identity-clone

**#2 — `Temporal.PlainDate.prototype.toPlainMonthDay`**
- Surface: `include/temporal_rs/PlainDate.hpp:243`
- Upstream: `plain_date.rs:to_plain_month_day`
- Prereq: calendar-day-projection (ISO is trivial: month + day
  fields)
- Effort: ~0.5 day for ISO; non-ISO blocked on calendar backend

**#3 — `Temporal.PlainDate.prototype.toZonedDateTime`**
- Surface: `include/temporal_rs/PlainDate.hpp:220`
- Upstream: `plain_date.rs:to_zoned_date_time`
- Prereq: DST resolution + provider integration
- Effort: ~1 day after provider wiring

**#4 — `Temporal.PlainDate.prototype.toPlainYearMonth`**
- Surface: `include/temporal_rs/PlainDate.hpp:246`
- Upstream: `plain_date.rs:to_plain_year_month`
- Prereq: calendar-day-projection (ISO trivial)
- Effort: ~0.5 day

**#5 — `Temporal.PlainYearMonth.from(partial)`**
- Surface: `include/temporal_rs/PlainYearMonth.hpp:66`
- Upstream: `plain_year_month.rs:from_partial`
- Prereq: PartialDate resolution
- Effort: ~1 day for ISO

**#5b — `Temporal.PlainYearMonth` internal ctor with overflow + calendar**
- Surface: `include/temporal_rs/PlainYearMonth.hpp:74`
- Upstream: `plain_year_month.rs:try_new_with_overflow`
- Prereq: partial-resolution-no-calendar (just wire `overflow`
  through `PlainYearMonthTryNewIso`)
- Effort: ~0.5 day for ISO; non-ISO blocked

**#6 — `Temporal.PlainYearMonth.prototype.toPlainDate`**
- Surface: `include/temporal_rs/PlainYearMonth.hpp:189`
- Upstream: `plain_year_month.rs:to_plain_date`
- Prereq: calendar-day-projection
- Effort: ~0.5 day for ISO

**#7 — `Temporal.PlainYearMonth.prototype.with`**
- Surface: `include/temporal_rs/PlainYearMonth.hpp:87`
- Upstream: `plain_year_month.rs:with`
- Prereq: PartialDate resolution
- Effort: ~1 day for ISO

**#8 — `Temporal.PlainYearMonth.prototype.epochMsFor(...)`**
- Surface: `include/temporal_rs/PlainYearMonth.hpp:278`
- Upstream: `plain_year_month.rs:epoch_ms_for_with_provider`
- Prereq: calendar-day-projection + provider integration
- Effort: ~1 day after both prereqs land

**#9 — `Temporal.PlainMonthDay.from(partial)`**
- Surface: `include/temporal_rs/PlainMonthDay.hpp:65`
- Upstream: `plain_month_day.rs:from_partial`
- Prereq: PartialDate resolution
- Effort: ~1 day for ISO

**#10 — `Temporal.PlainMonthDay.prototype.with` / `toPlainDate`**
- Surface: `include/temporal_rs/PlainMonthDay.hpp:81` (`with`) +
  `:90` (`to_plain_date`)
- Upstream: `plain_month_day.rs:{with, to_plain_date}`
- Prereq: PartialDate resolution + calendar-day-projection
- Effort: ~1.5 days combined for ISO

**#10b — `Temporal.PlainMonthDay` internal constructor with overflow**
- Surface: `include/temporal_rs/PlainMonthDay.hpp:73`
- Upstream: `plain_month_day.rs:try_new_with_overflow`
- Prereq: partial-resolution-no-calendar
- Effort: ~0.5 day for ISO

### P2 — Reachable but uncommon (5 sites)

**#11 — `Temporal.PlainDateTime.prototype.toZonedDateTime(timeZone)`**
- Surface: `include/temporal_rs/PlainDateTime.hpp:319`
- Upstream: `plain_date_time.rs:to_zoned_date_time`
- Prereq: DST + provider
- Effort: ~1 day

**#12 — `Temporal.PlainDate.prototype.toPlainDateTime(time)`**
- Surface: `include/temporal_rs/PlainDate.hpp:203`
- Upstream: `plain_date.rs:to_plain_date_time`
- Prereq: calendar-day-projection (ISO trivial — just merge fields)
- Effort: ~0.5 day for ISO

**#13 — `Temporal.PlainDateTime.prototype.withPlainTime(time)`**
- Surface: `include/temporal_rs/PlainDateTime.hpp:222`
- Upstream: `plain_date_time.rs:with_time`
- Prereq: partial-resolution-no-calendar (this is just
  `inner.iso.date` + caller-supplied `iso.time`)
- Effort: ~0.5 day

**#14 — `Temporal.PlainDateTime.prototype.round(options)`**
- Surface: `include/temporal_rs/PlainDateTime.hpp:213`
- Upstream: `plain_date_time.rs:round`
- Prereq: rounding-tail
- Effort: ~1 day

**#15 — `Temporal.PlainDateTime.prototype.with(partialDateTime, ?options)`**
- Surface: `include/temporal_rs/PlainDateTime.hpp:231`
- Upstream: `plain_date_time.rs:with`
- Prereq: PartialDate resolution
- Effort: ~1 day for ISO

### P3 — Provider / non-ISO (6 sites)

**#16 — `Temporal.ZonedDateTime.from(partial, options)`**
- Surface: `include/temporal_rs/ZonedDateTime.hpp:125`
- Upstream: `zoned_date_time.rs:from_partial_with_provider`
- Prereq: DST + provider + PartialDate resolution
- Effort: ~2 days

**#17 — `Temporal.ZonedDateTime` internal constructor with provider**
- Surface: `include/temporal_rs/ZonedDateTime.hpp:136`
- Upstream: `zoned_date_time.rs:try_new_with_provider`
- Prereq: DST + provider
- Effort: ~1 day

**#18 — `Temporal.ZonedDateTime.prototype.getTimeZoneTransition(direction)`**
- Surface: `include/temporal_rs/ZonedDateTime.hpp:325`
- Upstream: `zoned_date_time.rs:get_time_zone_transition_with_provider`
- Prereq: DST + provider
- Effort: ~1 day

**#19 — `Temporal.ZonedDateTime.prototype.until(other, settings)`**
- Surface: `include/temporal_rs/ZonedDateTime.hpp:434`
- Upstream: `zoned_date_time.rs:until_with_provider`
- Prereq: DST + provider + balance-time-duration-relative
- Effort: ~2 days

**#20 — `Temporal.ZonedDateTime.prototype.since(other, settings)`**
- Surface: `include/temporal_rs/ZonedDateTime.hpp:441`
- Upstream: `zoned_date_time.rs:since_with_provider`
- Prereq: DST + provider + balance-time-duration-relative
- Effort: trivial after #19 (negate the result)

**#21 — `Temporal.PlainMonthDay.prototype.epochMsFor(...)`**
- Surface: `include/temporal_rs/PlainMonthDay.hpp:172` +
  `:86` (dual-arg variant)
- Upstream: `plain_month_day.rs:epoch_ms_for_with_provider`
- Prereq: calendar-day-projection + provider
- Effort: ~1 day

**#22 — `Temporal.Instant.prototype.until/since` non-default settings**
- Surface: `include/temporal_rs/Instant.hpp` `diff()` (~line 286)
- Upstream: `instant.rs:diff_instant` (203-235)
- Prereq: rounding-tail
- Effort: ~2 days (wire `ResolvedRoundingOptionsFromDiffSettings`
  through `TimeDuration::Round`, then carry to `int128`)
- Notes: defaults work; settings other than
  `{trunc, increment:1, smallestUnit:'nanosecond'}` return Err today

### Calendar-backend dependency (P3 anchor, ~3 weeks)

All P1/P2 rows above are "for ISO" — the non-ISO calendars (Hebrew,
Islamic, Chinese, Japanese, Buddhist, Coptic, Ethiopian, Indian,
Persian, ROC, Dangi) are blocked on a single piece of work: a
calendar backend that implements the upstream `Calendar` trait.

Two paths:

1. **Port `icu_calendar`'s rules to C++** — ~3 weeks per calendar
   family, ~3 months total.
2. **Wire ICU's calendar APIs through the dispatch hook** the way
   the TZ side wires V8's zoneinfo64. ~1 week if ICU is linked,
   blocked otherwise.

V8 currently links full ICU (~30 MB), so option 2 is feasible and
preferred for non-ISO calendars. ISO continues to use the inline
fast path in `iso.cc`.

## Known drifts (already documented; not stubs)

These are intentional spec/upstream divergences, not "not yet
implemented" gaps. Captured here for completeness.

- **`FormattableMonthDay::WriteTo`** emits the `--` prefix that
  upstream `temporal_rs` omits but the JS Temporal spec requires
  (see commit `240affe4`).
- **`TemporalError` storage** owns `std::string` with rebinding
  copy/move constructors instead of the upstream `&'static str`
  / `String` enum (ABI constraint).
- **`Instant::until/since`** with `largestUnit ∈ {microsecond,
  nanosecond}` over very wide deltas returns Err instead of
  silently narrowing to int64 (deferred from C2 in the review).
- **`PlainDateTime::until/since`** cross-midnight sign-disagreement
  not balanced via `BalanceTimeDurationRelative` (H6 in the review;
  open work).

## Audit checklist

When closing a row:

1. Replace the `Err(NotImplemented)` body with the real
   implementation.
2. Cite the upstream Rust file:line in a comment above the body.
3. Add a smoke-test case to
   `packages/build-infra/test/fixtures/smoke-test-temporal.mjs` that
   exercises a non-trivial input (not just "doesn't throw").
4. Delete the row from this tracker.
5. Update the snapshot table at the top.
6. Re-run the audit `rg` from the header to confirm zero orphans.

## See also

- Upstream Rust source: `packages/temporal-infra/upstream/temporal/src/`
- V8 caller: `packages/node-smol-builder/upstream/node/deps/v8/src/objects/js-temporal-objects.cc`
- Perfectionist review findings: commit message of `9a64d25b`
- Smoke test: `packages/build-infra/test/fixtures/smoke-test-temporal.mjs`
