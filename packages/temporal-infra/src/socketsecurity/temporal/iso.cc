// ISO 8601 calendar arithmetic — Gregorian-only date math.
//
// Each function below is a direct translation of the spec abstract op
// it documents. Spec section anchors at https://tc39.es/proposal-temporal/.

#include "socketsecurity/temporal/iso.h"

#include <algorithm>
#include <cmath>

namespace node {
namespace socketsecurity {
namespace temporal {

// Spec: ISODayOfWeek(year, month, day)
// Tomohiko Sakamoto's algorithm. Returns 1..7 (Monday=1, Sunday=7).
//
// Sakamoto's lookup is keyed on month, with the month-of-March-as-13
// trick so the leap year only affects Jan/Feb (handled by the
// year-- when month < 3). The constant returns days as offsets from
// Sunday=0; we shift to Monday=1 at the end.
uint8_t ISODayOfWeek(int32_t year, uint8_t month, uint8_t day) noexcept {
  // Sakamoto's offsets (one per month, 1-indexed via leading 0).
  static constexpr int kMonthOffsets[13] = {0, 0, 3, 2, 5, 0, 3,
                                            5, 1, 4, 6, 2, 4};
  if (month < 3) {
    year -= 1;
  }
  // Mathematical mod with negative-year handling: ((y + y/4 - y/100 +
  // y/400 + monthOff + day) mod 7) gives Sunday=0. Adjust to ISO.
  int sunday_zero = (year + year / 4 - year / 100 + year / 400 +
                     kMonthOffsets[month] + day) %
                    7;
  if (sunday_zero < 0) {
    sunday_zero += 7;
  }
  // Sunday=0 → ISO 7; Mon=1 → ISO 1. Equivalent: if 0 then 7 else as-is.
  return static_cast<uint8_t>(sunday_zero == 0 ? 7 : sunday_zero);
}

// Spec: ISODayOfYear(year, month, day)
// Returns 1..366. Cumulative days through the start of `month`, plus
// `day`. Computed via per-month sum, leap-year-aware via Feb adjust.
uint16_t ISODayOfYear(int32_t year, uint8_t month, uint8_t day) noexcept {
  // Cumulative days at the start of each month (non-leap year).
  static constexpr uint16_t kCumulative[13] = {
      0,    // Padding so [1] = January = 0
      0,    // Jan: 0 days before
      31,   // Feb: 31
      59,   // Mar: 31+28
      90,   // Apr: 59+31
      120,  // May: 90+30
      151,  // Jun: 120+31
      181,  // Jul: 151+30
      212,  // Aug: 181+31
      243,  // Sep: 212+31
      273,  // Oct: 243+30
      304,  // Nov: 273+31
      334,  // Dec: 304+30
  };
  uint16_t doy = kCumulative[month] + day;
  // After Feb, leap years add a day.
  if (month > 2 && IsLeapYear(year)) {
    doy += 1;
  }
  return doy;
}

// Spec: ISOWeekOfYear(year, month, day)
// ISO 8601 week numbering: Mon-Sun weeks; week 1 contains the first
// Thursday of the year; weeks at year boundaries can belong to the
// adjacent year.
//
// Algorithm: compute the Thursday of the same ISO week, then take its
// year and the number of days from Jan 4 (the canonical date that's
// always in week 1).
uint8_t ISOWeekOfYear(int32_t year, uint8_t month, uint8_t day) noexcept {
  // Day-of-year for the input.
  uint16_t doy = ISODayOfYear(year, month, day);
  uint8_t dow = ISODayOfWeek(year, month, day);  // 1..7 Mon..Sun

  // Thursday of the input's week, expressed as a day-of-year. The
  // Thursday is `doy + (4 - dow)`. Negative or out-of-range values
  // mean the Thursday lives in the prev/next year — but we don't need
  // to resolve that for the week number alone, just compute as if.
  int thursday_doy = static_cast<int>(doy) + (4 - static_cast<int>(dow));

  // Three cases:
  //   1. Thursday falls in the current year (1..365 or 1..366) — week
  //      is ((thursday_doy - 1) / 7) + 1.
  //   2. Thursday falls in the previous year — week is the last week
  //      of the previous year (52 or 53).
  //   3. Thursday falls in the next year — week is 1.
  uint16_t year_len = IsLeapYear(year) ? 366 : 365;
  if (thursday_doy < 1) {
    // Borrowed from previous year. Last week of (year - 1).
    return ISOWeekOfYear(year - 1, 12, 31);
  }
  if (thursday_doy > static_cast<int>(year_len)) {
    // Borrowed by next year. First week of (year + 1).
    return 1;
  }
  return static_cast<uint8_t>((thursday_doy - 1) / 7 + 1);
}

// Spec: BalanceISODate(year, month, day)
// Carries day → month → year. Used when arithmetic produces a date
// with an out-of-range day or month.
//
// Strategy:
//   1. Normalize month to 1..12 by carrying into year.
//   2. Then if day is out of range for that (year, month), carry
//      day forward by subtracting the month's length and incrementing
//      month, repeating; or backward (negative day) by going to the
//      prior month.
//
// Note: spec actually does this via a single algorithm; this loop is
// equivalent and easier to reason about. Worst-case loop count is
// bounded by the input magnitude / 28 = small for realistic inputs.
IsoDate BalanceISODate(int32_t year, int32_t month, int32_t day) noexcept {
  // Step 1: month carry.
  if (month < 1 || month > 12) {
    // Convert month to 0-indexed for cleaner mod math, then back.
    int32_t zero_month = month - 1;
    int32_t year_carry = zero_month / 12;
    zero_month %= 12;
    if (zero_month < 0) {
      zero_month += 12;
      year_carry -= 1;
    }
    year += year_carry;
    month = zero_month + 1;
  }

  // Step 2: day carry.
  while (day < 1) {
    // Step back one month.
    if (month == 1) {
      month = 12;
      year -= 1;
    } else {
      month -= 1;
    }
    day += ISODaysInMonth(year, static_cast<uint8_t>(month));
  }
  while (day > ISODaysInMonth(year, static_cast<uint8_t>(month))) {
    day -= ISODaysInMonth(year, static_cast<uint8_t>(month));
    if (month == 12) {
      month = 1;
      year += 1;
    } else {
      month += 1;
    }
  }

  IsoDate result;
  result.year = year;
  result.month = static_cast<uint8_t>(month);
  result.day = static_cast<uint8_t>(day);
  return result;
}

// Spec: RegulateISODate(year, month, day, "constrain")
// Constrains by clamping each field to its valid range, in order.
// (Unlike BalanceISODate which carries.) This is the spec's behavior
// for the `overflow: 'constrain'` option in PlainDate constructors.
IsoDate RegulateISODateConstrain(int32_t year, int32_t month,
                                 int32_t day) noexcept {
  IsoDate out;
  // Year is unconstrained at this stage — IsValid() will catch the
  // ±271821..275760 limit downstream.
  out.year = year;
  // Month: clamp to 1..12.
  out.month = static_cast<uint8_t>(std::clamp(month, 1, 12));
  // Day: clamp to 1..ISODaysInMonth(year, month).
  uint8_t max_day = ISODaysInMonth(year, out.month);
  out.day = static_cast<uint8_t>(std::clamp(day, 1, static_cast<int32_t>(max_day)));
  return out;
}

// Spec: AddISODate(year, month, day, years, months, weeks, days, "constrain")
// Calendar arithmetic with the "constrain" overflow mode (the default
// per the spec where unspecified). Order matters per spec:
//   1. Add years + months together to (year + years, month + months,
//      day), then balance month and constrain day.
//   2. Add (weeks*7 + days) to that result, then balance.
IsoDate AddISODate(const IsoDate& base, int32_t years, int32_t months,
                   int32_t weeks, int32_t days) noexcept {
  // Step 1: years + months. Balance month into year first, then
  // constrain day to that year/month's range.
  int32_t y = base.year + years;
  int32_t m = static_cast<int32_t>(base.month) + months;
  // Carry m → y.
  int32_t zero_month = m - 1;
  int32_t year_carry = zero_month / 12;
  zero_month %= 12;
  if (zero_month < 0) {
    zero_month += 12;
    year_carry -= 1;
  }
  y += year_carry;
  m = zero_month + 1;
  // Now constrain day to ISODaysInMonth(y, m). Spec's "constrain"
  // means clamp, not overflow — Jan 31 + 1 month = Feb 28 (or 29 in
  // leap), not Mar 3.
  int32_t d = std::min(static_cast<int32_t>(base.day),
                       static_cast<int32_t>(ISODaysInMonth(y, static_cast<uint8_t>(m))));

  // Step 2: weeks + days, then balance.
  d += weeks * 7 + days;
  return BalanceISODate(y, m, d);
}

// Helper: compute the Julian Day Number (JDN) for a Gregorian date.
// Used internally by DifferenceISODate to compute exact day deltas.
//
// Standard Fliegel-Van Flandern formula. Produces a monotonic int that
// can be subtracted to get exact days between two dates regardless of
// leap years.
static int64_t ToJDN(int32_t year, uint8_t month, uint8_t day) noexcept {
  int32_t a = (14 - month) / 12;
  int32_t y = year + 4800 - a;
  int32_t m = month + 12 * a - 3;
  return static_cast<int64_t>(day) + (153 * m + 2) / 5 + 365 * y + y / 4 -
         y / 100 + y / 400 - 32045;
}

// Spec: DifferenceISODate(y1, m1, d1, y2, m2, d2, "day")
// Returns the difference as a Duration with only the `days` field set.
// `largestUnit` ≠ "day" (years/months/weeks) requires calendar-aware
// handling — that lands with the calendar binding (icu_calendar.cc,
// forthcoming); the "day" path is enough for the time-difference
// fallback that most arithmetic routes through.
//
// TODO(temporal-port): handle largestUnit ∈ {year, month, week} per
// https://tc39.es/proposal-temporal/#sec-temporal-differenceisodate.
// Current behavior: always returns the difference as days.
Duration DifferenceISODate(const IsoDate& earlier,
                           const IsoDate& later) noexcept {
  Duration d = {};
  int64_t earlier_jdn = ToJDN(earlier.year, earlier.month, earlier.day);
  int64_t later_jdn = ToJDN(later.year, later.month, later.day);
  d.days = static_cast<double>(later_jdn - earlier_jdn);
  return d;
}

}  // namespace temporal
}  // namespace socketsecurity
}  // namespace node
