// ISO 8601 calendar arithmetic — Gregorian-only date math used by every
// Temporal type that doesn't carry an explicit non-ISO calendar.
//
// Spec references map to abstract operations in
// https://tc39.es/proposal-temporal/#sec-temporal-iso8601-grammar and
// https://tc39.es/proposal-temporal/#sec-temporal-isodaterecord
//
// Algorithms are direct translations of the spec, not inferences from
// boa-dev/temporal's `src/iso.rs` — the spec is the source of truth and
// also the reference temporal_rs follows.

#ifndef SRC_SOCKETSECURITY_TEMPORAL_ISO_H_
#define SRC_SOCKETSECURITY_TEMPORAL_ISO_H_

#include <cstdint>

#include "socketsecurity/temporal/temporal.h"

namespace node {
namespace socketsecurity {
namespace temporal {

// Spec: IsLeapYear(year)
// "Mathematically: leap iff (year mod 4 == 0) AND ((year mod 100 != 0)
//  OR (year mod 400 == 0))." Spec uses Number.MAX_SAFE_INTEGER years;
// our int32_t covers ±271821..275760 which is the Temporal-valid range.
constexpr bool IsLeapYear(int32_t year) noexcept {
  return (year % 4 == 0) && ((year % 100 != 0) || (year % 400 == 0));
}

// Spec: ISODaysInMonth(year, month)
// month is 1-indexed (1..12). Returns 28..31.
constexpr uint8_t ISODaysInMonth(int32_t year, uint8_t month) noexcept {
  // Lookup matches the spec's switch on month, with Feb leap-aware.
  switch (month) {
    case 1:
    case 3:
    case 5:
    case 7:
    case 8:
    case 10:
    case 12:
      return 31;
    case 4:
    case 6:
    case 9:
    case 11:
      return 30;
    case 2:
      return IsLeapYear(year) ? 29 : 28;
    default:
      return 0;  // Caller validates month range; 0 signals "out of range."
  }
}

// Spec: ISODayOfWeek(year, month, day)
// Returns 1..7 (Monday=1, Sunday=7) per ISO 8601.
// Implemented via Tomohiko Sakamoto's algorithm — branchless after the
// month adjustment, no lookup tables needed.
uint8_t ISODayOfWeek(int32_t year, uint8_t month, uint8_t day) noexcept;

// Spec: ISODayOfYear(year, month, day)
// Returns 1..366. Cumulative days through the start of `month`, plus
// `day`. Leap-year-aware via the IsLeapYear-driven Feb count.
uint16_t ISODayOfYear(int32_t year, uint8_t month, uint8_t day) noexcept;

// Spec: ToISODayOfWeek-derived ISO 8601 week number (1..53).
// Returns the spec's `ISOWeekOfYear(year, month, day)`. Uses the
// Thursday-anchored ISO 8601 rule: a week belongs to the year of its
// Thursday.
uint8_t ISOWeekOfYear(int32_t year, uint8_t month, uint8_t day) noexcept;

// Spec: BalanceISODate(year, month, day)
// Normalizes a possibly-out-of-range date by carrying day → month →
// year. Used internally by date arithmetic when components overflow
// (e.g. Feb 30 → Mar 2 on a non-leap year). Returns a bare IsoDate
// (no calendar attached); caller wraps in PlainDate if needed.
IsoDate BalanceISODate(int32_t year, int32_t month, int32_t day) noexcept;

// Spec: RegulateISODate(year, month, day, "constrain")
// Constrains by clamping each field to its valid range (the spec's
// `overflow: 'constrain'` mode). The "reject" mode is implemented by
// each PlainXxxNewWithOverflow caller, which checks IsValid() after
// raw construction — this helper only handles the constrain path.
IsoDate RegulateISODateConstrain(int32_t year, int32_t month,
                                 int32_t day) noexcept;

// Spec: AddISODate(year, month, day, years, months, weeks, days, overflow)
// Calendar-aware date addition. Years and months are added first
// (preserving day-of-month, then constraining), then weeks*7 + days.
// Overflow on out-of-range output is signalled via IsoDate::IsValid().
IsoDate AddISODate(const IsoDate& base, int32_t years, int32_t months,
                   int32_t weeks, int32_t days) noexcept;

// Spec: DifferenceISODate(y1, m1, d1, y2, m2, d2, "day")
// Returns the day-difference as a Duration (only `days` non-zero).
// year/month/week breakdowns are calendar-aware and route through
// CalendarDateUntil → the registered CalendarBackend (calendar.h).
Duration DifferenceISODate(const IsoDate& earlier,
                           const IsoDate& later) noexcept;

// ── IsoTime helpers ───────────────────────────────────────────────────
// Forward-decl to avoid pulling in duration_normalized.h here.
class TimeDuration;

// Spec: BalanceTime(hour, minute, second, ms, us, ns)
// Returns (days, balanced_time). Carries over each field into the next
// magnitude. Uses Euclid semantics (negative inputs get borrowed) so
// arithmetic with negative TimeDuration deltas balances correctly.
struct BalanceTimeResult {
  int64_t days;
  IsoTime time;
};
BalanceTimeResult BalanceIsoTime(int64_t hour, int64_t minute, int64_t second,
                                  int64_t millisecond, int64_t microsecond,
                                  int64_t nanosecond) noexcept;

// Spec-equivalent of upstream's `IsoTime::diff(other)`. Returns a
// TimeDuration representing `other - self`.
TimeDuration DiffIsoTime(const IsoTime& self, const IsoTime& other) noexcept;

// Spec-equivalent of upstream's `IsoTime::add(norm)`. Adds a normalized
// TimeDuration to a time-of-day; carries day overflow.
BalanceTimeResult AddIsoTime(const IsoTime& self,
                              const TimeDuration& norm) noexcept;

// Forward decl — pulled in via duration_normalized.h or options.h at
// call sites; keeping the iso.h surface small.
struct ResolvedRoundingOptions;

// Spec-equivalent of upstream's `IsoTime::round(options)`. Rounds the
// time-of-day per the resolved options; returns (days, balanced_time)
// — `days` non-zero only when smallestUnit is Day or Hour and the
// rounded value crosses midnight.
struct RoundedTime {
  int64_t days;
  IsoTime time;
};
TemporalResult<RoundedTime> RoundIsoTime(
    const IsoTime& self, const ResolvedRoundingOptions& options) noexcept;

}  // namespace temporal
}  // namespace socketsecurity
}  // namespace node

#endif  // SRC_SOCKETSECURITY_TEMPORAL_ISO_H_
