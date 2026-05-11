// ISO 8601 calendar arithmetic — Gregorian-only date math.
//
// Each function below is a direct translation of the spec abstract op
// it documents. Spec section anchors at https://tc39.es/proposal-temporal/.

#include "socketsecurity/temporal/iso.h"

#include "socketsecurity/temporal/duration_normalized.h"
#include "socketsecurity/temporal/options.h"
#include "socketsecurity/temporal/utils.h"

#include <algorithm>
#include <cmath>
#include <limits>

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
// `largestUnit` ∈ {year, month, week} requires calendar-aware
// handling and routes through CalendarDateUntil (which delegates to
// the registered CalendarBackend).
Duration DifferenceISODate(const IsoDate& earlier,
                           const IsoDate& later) noexcept {
  Duration d = {};
  int64_t earlier_jdn = ToJDN(earlier.year, earlier.month, earlier.day);
  int64_t later_jdn = ToJDN(later.year, later.month, later.day);
  d.days = static_cast<double>(later_jdn - earlier_jdn);
  return d;
}

// ── IsoTime helpers ───────────────────────────────────────────────────

namespace {

// Mirror Rust's `i64::div_euclid(divisor)` and `rem_euclid(divisor)`.
// In particular, the remainder is always non-negative when divisor > 0.
struct DivMod {
  int64_t quotient;
  int64_t remainder;
};
DivMod EuclidDivMod(int64_t numerator, int64_t divisor) noexcept {
  // C++ '%' truncates toward zero; for negative numerator with
  // positive divisor, the remainder is non-positive. Adjust to match
  // Euclid (always non-negative) semantics.
  int64_t q = numerator / divisor;
  int64_t r = numerator % divisor;
  if (r < 0) {
    if (divisor > 0) {
      q -= 1;
      r += divisor;
    } else {
      q += 1;
      r -= divisor;
    }
  }
  return {q, r};
}

}  // namespace

BalanceTimeResult BalanceIsoTime(int64_t hour, int64_t minute, int64_t second,
                                  int64_t millisecond, int64_t microsecond,
                                  int64_t nanosecond) noexcept {
  // Carry chain: ns → us → ms → s → m → h → days. Each step uses
  // Euclid div/mod so negative values borrow correctly.
  auto step = [](int64_t into_smaller, int64_t* carry,
                  int64_t modulus) -> int64_t {
    DivMod dm = EuclidDivMod(into_smaller, modulus);
    *carry += dm.quotient;
    return dm.remainder;
  };

  int64_t us_carry = microsecond;
  int64_t ns_part = step(nanosecond, &us_carry, 1000);

  int64_t ms_carry = millisecond;
  int64_t us_part = step(us_carry, &ms_carry, 1000);

  int64_t s_carry = second;
  int64_t ms_part = step(ms_carry, &s_carry, 1000);

  int64_t min_carry = minute;
  int64_t s_part = step(s_carry, &min_carry, 60);

  int64_t hr_carry = hour;
  int64_t min_part = step(min_carry, &hr_carry, 60);

  int64_t day_carry = 0;
  int64_t hr_part = step(hr_carry, &day_carry, 24);

  IsoTime t;
  t.hour = static_cast<uint8_t>(hr_part);
  t.minute = static_cast<uint8_t>(min_part);
  t.second = static_cast<uint8_t>(s_part);
  t.millisecond = static_cast<uint16_t>(ms_part);
  t.microsecond = static_cast<uint16_t>(us_part);
  t.nanosecond = static_cast<uint16_t>(ns_part);
  return {day_carry, t};
}

TimeDuration DiffIsoTime(const IsoTime& self, const IsoTime& other) noexcept {
  // Mirror upstream: TimeDuration::from_components on the per-field
  // deltas. Fields are u8/u16; deltas live in i64 / i128 ranges easily.
  const int64_t h = static_cast<int64_t>(other.hour) -
                    static_cast<int64_t>(self.hour);
  const int64_t m = static_cast<int64_t>(other.minute) -
                    static_cast<int64_t>(self.minute);
  const int64_t s = static_cast<int64_t>(other.second) -
                    static_cast<int64_t>(self.second);
  const int64_t ms = static_cast<int64_t>(other.millisecond) -
                     static_cast<int64_t>(self.millisecond);
  const Int128 us(static_cast<int64_t>(other.microsecond) -
                  static_cast<int64_t>(self.microsecond));
  const Int128 ns(static_cast<int64_t>(other.nanosecond) -
                  static_cast<int64_t>(self.nanosecond));
  return TimeDuration::FromComponents(h, m, s, ms, us, ns);
}

BalanceTimeResult AddIsoTime(const IsoTime& self,
                              const TimeDuration& norm) noexcept {
  // Mirror upstream's IsoTime::add: shift second + nanosecond fields by
  // the duration's seconds + sub-seconds, then balance.
  const int64_t seconds = static_cast<int64_t>(self.second) + norm.Seconds();
  const int64_t nanos = static_cast<int64_t>(self.nanosecond) +
                        static_cast<int64_t>(norm.Subseconds());
  return BalanceIsoTime(static_cast<int64_t>(self.hour),
                        static_cast<int64_t>(self.minute), seconds,
                        static_cast<int64_t>(self.millisecond),
                        static_cast<int64_t>(self.microsecond), nanos);
}

TemporalResult<RoundedTime> RoundIsoTime(
    const IsoTime& self, const ResolvedRoundingOptions& options) noexcept {
  // Mirror upstream's IsoTime::round. Convert the time-of-day to a
  // single magnitude (in nanoseconds, except for `minute` etc. where
  // we strip outer fields), then round, then balance back.
  const Unit unit = options.smallest_unit;
  Int128 quantity;
  switch (unit) {
    case Unit::kDay:
    case Unit::kHour: {
      Int128 minutes = Int128(static_cast<int64_t>(self.hour)) * Int128(60) +
                        Int128(static_cast<int64_t>(self.minute));
      Int128 seconds =
          minutes * Int128(60) + Int128(static_cast<int64_t>(self.second));
      Int128 millis = seconds * Int128(1000) +
                       Int128(static_cast<int64_t>(self.millisecond));
      Int128 micros =
          millis * Int128(1000) + Int128(static_cast<int64_t>(self.microsecond));
      quantity = micros * Int128(1000) +
                  Int128(static_cast<int64_t>(self.nanosecond));
      break;
    }
    case Unit::kMinute: {
      Int128 seconds = Int128(static_cast<int64_t>(self.minute)) * Int128(60) +
                        Int128(static_cast<int64_t>(self.second));
      Int128 millis = seconds * Int128(1000) +
                       Int128(static_cast<int64_t>(self.millisecond));
      Int128 micros =
          millis * Int128(1000) + Int128(static_cast<int64_t>(self.microsecond));
      quantity = micros * Int128(1000) +
                  Int128(static_cast<int64_t>(self.nanosecond));
      break;
    }
    case Unit::kSecond: {
      Int128 millis =
          Int128(static_cast<int64_t>(self.second)) * Int128(1000) +
          Int128(static_cast<int64_t>(self.millisecond));
      Int128 micros = millis * Int128(1000) +
                       Int128(static_cast<int64_t>(self.microsecond));
      quantity = micros * Int128(1000) +
                  Int128(static_cast<int64_t>(self.nanosecond));
      break;
    }
    case Unit::kMillisecond: {
      Int128 micros = Int128(static_cast<int64_t>(self.millisecond)) *
                          Int128(1000) +
                      Int128(static_cast<int64_t>(self.microsecond));
      quantity = micros * Int128(1000) +
                  Int128(static_cast<int64_t>(self.nanosecond));
      break;
    }
    case Unit::kMicrosecond:
      quantity = Int128(static_cast<int64_t>(self.microsecond)) *
                      Int128(1000) +
                  Int128(static_cast<int64_t>(self.nanosecond));
      break;
    case Unit::kNanosecond:
      quantity = Int128(static_cast<int64_t>(self.nanosecond));
      break;
    default:
      return TemporalError::Range(
          "Invalid smallestUnit value for time rounding.");
  }
  // Length in nanoseconds.
  auto unit_ns_opt = UnitAsNanoseconds(unit);
  if (!unit_ns_opt.has_value()) {
    return TemporalError::Range("Round: invalid unit");
  }
  const uint64_t unit_ns = *unit_ns_opt;
  const uint64_t increment_ns =
      static_cast<uint64_t>(options.increment.Get()) * unit_ns;

  // Round `quantity` to nearest multiple of `increment_ns` per the
  // mode, then divide back by `unit_ns` to produce the rounded count
  // of `unit`s.
  const bool sign = quantity >= Int128(0);
  const UnsignedRoundingMode unsigned_mode =
      RoundingModeGetUnsigned(options.rounding_mode, sign);
  Int128 abs_q = sign ? quantity : -quantity;
  Int128 inc(static_cast<int64_t>(increment_ns));
  Int128 r1 = abs_q / inc;
  Int128 rem = abs_q % inc;
  Int128 rounded;
  if (rem == Int128(0) || unsigned_mode == UnsignedRoundingMode::kZero) {
    rounded = r1;
  } else if (unsigned_mode == UnsignedRoundingMode::kInfinity) {
    rounded = r1 + Int128(1);
  } else {
    Int128 twice_rem = rem + rem;
    if (twice_rem < inc) {
      rounded = r1;
    } else if (twice_rem > inc) {
      rounded = r1 + Int128(1);
    } else {
      switch (unsigned_mode) {
        case UnsignedRoundingMode::kHalfZero:
          rounded = r1;
          break;
        case UnsignedRoundingMode::kHalfInfinity:
          rounded = r1 + Int128(1);
          break;
        case UnsignedRoundingMode::kHalfEven: {
          Int128 mod = r1 % Int128(2);
          rounded = (mod == Int128(0)) ? r1 : r1 + Int128(1);
          break;
        }
        default:
          rounded = r1;
          break;
      }
    }
  }
  if (!sign) rounded = -rounded;
  // Multiply back by `inc`, then divide by `unit_ns` (unit_ns =
  // length-in-ns for the unit). The rounded result, expressed in
  // `unit` magnitudes.
  Int128 rounded_total_ns = rounded * inc;
  Int128 result_units = rounded_total_ns / Int128(static_cast<int64_t>(unit_ns));
  const int64_t r = result_units.ToInt64();

  switch (unit) {
    case Unit::kDay:
      return RoundedTime{r, IsoTime{}};
    case Unit::kHour: {
      auto b = BalanceIsoTime(r, 0, 0, 0, 0, 0);
      return RoundedTime{b.days, b.time};
    }
    case Unit::kMinute: {
      auto b = BalanceIsoTime(static_cast<int64_t>(self.hour), r, 0, 0, 0, 0);
      return RoundedTime{b.days, b.time};
    }
    case Unit::kSecond: {
      auto b = BalanceIsoTime(static_cast<int64_t>(self.hour),
                              static_cast<int64_t>(self.minute), r, 0, 0, 0);
      return RoundedTime{b.days, b.time};
    }
    case Unit::kMillisecond: {
      auto b = BalanceIsoTime(static_cast<int64_t>(self.hour),
                              static_cast<int64_t>(self.minute),
                              static_cast<int64_t>(self.second), r, 0, 0);
      return RoundedTime{b.days, b.time};
    }
    case Unit::kMicrosecond: {
      auto b = BalanceIsoTime(static_cast<int64_t>(self.hour),
                              static_cast<int64_t>(self.minute),
                              static_cast<int64_t>(self.second),
                              static_cast<int64_t>(self.millisecond), r, 0);
      return RoundedTime{b.days, b.time};
    }
    case Unit::kNanosecond: {
      auto b = BalanceIsoTime(static_cast<int64_t>(self.hour),
                              static_cast<int64_t>(self.minute),
                              static_cast<int64_t>(self.second),
                              static_cast<int64_t>(self.millisecond),
                              static_cast<int64_t>(self.microsecond), r);
      return RoundedTime{b.days, b.time};
    }
    default:
      return TemporalError::Assert("Unreachable: invalid unit in RoundIsoTime");
  }
}

// 1:1 from upstream iso.rs:158 `IsoDateTime::round`.
TemporalResult<IsoDateTime> RoundIsoDateTime(
    const IsoDateTime& self,
    const ResolvedRoundingOptions& options) noexcept {
  // let (rounded_days, rounded_time) = self.time.round(resolved_options)?
  auto round_result = RoundIsoTime(self.time, options);
  if (!round_result.ok()) {
    return TemporalResult<IsoDateTime>(round_result.error());
  }
  // let balance_result = IsoDate::try_balance(year, month.into(),
  //   i64::from(day) + rounded_days)?;
  const int64_t balanced_day =
      static_cast<int64_t>(self.date.day) + round_result.value().days;
  // Bound at MAX_EPOCH_DAYS (10^8 + 1), not int32::max (~2.1B).
  // Upstream `try_balance` rejects out-of-range inputs early
  // instead of letting BalanceISODate loop ~700M iterations on an
  // int32-max input. The spec's valid Temporal range bottoms out at
  // ±10^8 days; anything beyond is a programming error, not a math
  // problem to balance through.
  constexpr int64_t kMaxEpochDays = 100'000'001LL;
  if (balanced_day > kMaxEpochDays || balanced_day < -kMaxEpochDays) {
    return TemporalError::Range("PlainDateTime out of representable range");
  }
  IsoDate balanced = BalanceISODate(self.date.year, self.date.month,
                                     static_cast<int32_t>(balanced_day));
  IsoDateTime out{balanced, round_result.value().time};
  if (!out.IsValid()) {
    return TemporalError::Range("PlainDateTime is not within valid limits");
  }
  return out;
}

}  // namespace temporal
}  // namespace socketsecurity
}  // namespace node
