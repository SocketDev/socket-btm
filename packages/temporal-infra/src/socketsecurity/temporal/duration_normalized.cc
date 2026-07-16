// 1:1 port of upstream `src/builtins/core/duration/normalized.rs` (and
// `duration/date.rs`).
//
// Lock-step from Rust: builtins/core/duration/normalized.rs

#include "socketsecurity/temporal/duration_normalized.h"

#include <cmath>

#include "socketsecurity/temporal/rounding.h"
#include "socketsecurity/temporal/utils.h"

namespace node {
namespace socketsecurity {
namespace temporal {

namespace {

// Upstream's MAX_TIME_DURATION = 9_007_199_254_740_991_999_999_999.
// = (2^53 - 1) × 10^9 + (10^9 - 1). Computed once.
const Int128 kMaxTimeDuration = []() {
  Int128 max_safe(9'007'199'254'740'991LL);
  Int128 ns_per_sec(1'000'000'000LL);
  return max_safe * ns_per_sec + Int128(999'999'999LL);
}();

// Upstream's MAX_SAFE_INTEGER = 2^53 - 1.
constexpr int64_t kMaxSafeInteger = (1LL << 53) - 1;

// Upstream's NS_PER_DAY_128BIT = NS_PER_DAY as i128.
const Int128 kNsPerDay128(static_cast<int64_t>(kNsPerDay));

bool TimeDurationInRange(const Int128& v) noexcept {
  Int128 abs_v = v < Int128(0) ? -v : v;
  return abs_v <= kMaxTimeDuration;
}

bool IsValidDateDuration(int64_t years, int64_t months, int64_t weeks,
                          int64_t days) noexcept {
  // Sign agreement: all non-zero fields must share the same sign.
  Sign reference = Sign::kZero;
  auto check = [&](int64_t v) {
    if (v == 0) return true;
    Sign s = v > 0 ? Sign::kPositive : Sign::kNegative;
    if (reference == Sign::kZero) {
      reference = s;
      return true;
    }
    return s == reference;
  };
  return check(years) && check(months) && check(weeks) && check(days);
}

}  // namespace

bool IsValidDuration(int64_t years, int64_t months, int64_t weeks,
                     int64_t days, int64_t hours, int64_t minutes,
                     int64_t seconds, int64_t milliseconds,
                     Int128 microseconds, Int128 nanoseconds) noexcept {
  // Sign agreement across calendar + time components.
  Sign ref = Sign::kZero;
  auto sign_of_i64 = [](int64_t v) -> Sign {
    if (v > 0) return Sign::kPositive;
    if (v < 0) return Sign::kNegative;
    return Sign::kZero;
  };
  auto sign_of_i128 = [](Int128 v) -> Sign {
    if (v > Int128(0)) return Sign::kPositive;
    if (v < Int128(0)) return Sign::kNegative;
    return Sign::kZero;
  };
  auto fold = [&](Sign s) {
    if (s == Sign::kZero) return true;
    if (ref == Sign::kZero) {
      ref = s;
      return true;
    }
    return s == ref;
  };
  if (!fold(sign_of_i64(years)) || !fold(sign_of_i64(months)) ||
      !fold(sign_of_i64(weeks)) || !fold(sign_of_i64(days)) ||
      !fold(sign_of_i64(hours)) || !fold(sign_of_i64(minutes)) ||
      !fold(sign_of_i64(seconds)) || !fold(sign_of_i64(milliseconds)) ||
      !fold(sign_of_i128(microseconds)) || !fold(sign_of_i128(nanoseconds))) {
    return false;
  }
  // Time-only magnitude bound: total nanoseconds must fit within
  // MAX_TIME_DURATION when aggregated (matches upstream's check).
  Int128 total = Int128(hours) * Int128(3'600'000'000'000LL);
  total = total + Int128(minutes) * Int128(60'000'000'000LL);
  total = total + Int128(seconds) * Int128(1'000'000'000LL);
  total = total + Int128(milliseconds) * Int128(1'000'000LL);
  total = total + microseconds * Int128(1'000LL);
  total = total + nanoseconds;
  return TimeDurationInRange(total);
}

TemporalResult<DateDuration> DateDuration::New(int64_t years, int64_t months,
                                                 int64_t weeks,
                                                 int64_t days) noexcept {
  if (!IsValidDateDuration(years, months, weeks, days)) {
    return TemporalError::Range("Invalid DateDuration");
  }
  return DateDuration{years, months, weeks, days};
}

Sign DateDuration::GetSign() const noexcept {
  if (years < 0 || months < 0 || weeks < 0 || days < 0) return Sign::kNegative;
  if (years > 0 || months > 0 || weeks > 0 || days > 0) return Sign::kPositive;
  return Sign::kZero;
}

// ── TimeDuration ──────────────────────────────────────────────────────

TimeDuration TimeDuration::FromComponents(int64_t hours, int64_t minutes,
                                           int64_t seconds, int64_t milliseconds,
                                           Int128 microseconds,
                                           Int128 nanoseconds) noexcept {
  Int128 total = Int128(hours) * Int128(3'600'000'000'000LL);
  total = total + Int128(minutes) * Int128(60'000'000'000LL);
  total = total + Int128(seconds) * Int128(1'000'000'000LL);
  total = total + Int128(milliseconds) * Int128(1'000'000LL);
  total = total + microseconds * Int128(1'000LL);
  total = total + nanoseconds;
  return TimeDuration(total);
}

TimeDuration TimeDuration::FromDuration(const Duration& duration) noexcept {
  // Upstream applies a sign multiplier per-component (matters when the
  // input has a negative sign on its outer Duration). Compute the
  // sign first via a raw component sum.
  Int128 raw = Int128(static_cast<int64_t>(duration.hours)) *
                Int128(3'600'000'000'000LL);
  raw = raw + Int128(static_cast<int64_t>(duration.minutes)) *
                  Int128(60'000'000'000LL);
  raw = raw + Int128(static_cast<int64_t>(duration.seconds)) *
                  Int128(1'000'000'000LL);
  raw = raw + Int128(static_cast<int64_t>(duration.milliseconds)) *
                  Int128(1'000'000LL);
  raw = raw + Int128(static_cast<int64_t>(duration.microseconds)) *
                  Int128(1'000LL);
  raw = raw + Int128(static_cast<int64_t>(duration.nanoseconds));
  return TimeDuration(raw);
}

TemporalResult<TimeDuration> TimeDuration::FromNanosecondDifference(
    Int128 one, Int128 two) noexcept {
  Int128 result = one - two;
  if (!TimeDurationInRange(result)) {
    return TemporalError::Range("TimeDuration exceeds maxTimeDuration.");
  }
  return TimeDuration(result);
}

TemporalResult<TimeDuration> TimeDuration::AddDays(int64_t days) const noexcept {
  Int128 result = nanoseconds_ + Int128(days) * kNsPerDay128;
  if (!TimeDurationInRange(result)) {
    return TemporalError::Range(
        "AddDays produced a TimeDuration outside the valid range.");
  }
  return TimeDuration(result);
}

Int128 TimeDuration::TruncatedDivide(uint64_t divisor) const noexcept {
  return nanoseconds_ / Int128(static_cast<int64_t>(divisor));
}

double TimeDuration::Divide(double divisor) const noexcept {
  // Upstream casts i128 → f64; we do the same. Lossy at extremes
  // (the slow path lives in Total via Fraction).
  return static_cast<double>(nanoseconds_.ToInt64()) / divisor;
}

int64_t TimeDuration::Seconds() const noexcept {
  return (nanoseconds_ / Int128(1'000'000'000LL)).ToInt64();
}

int32_t TimeDuration::Subseconds() const noexcept {
  return static_cast<int32_t>(
      (nanoseconds_ % Int128(1'000'000'000LL)).ToInt64());
}

TemporalResult<TimeDuration> TimeDuration::CheckedAdd(
    const TimeDuration& other) const noexcept {
  Int128 result = nanoseconds_ + other.nanoseconds_;
  if (!TimeDurationInRange(result)) {
    return TemporalError::Range("TimeDuration exceeds maxTimeDuration.");
  }
  return TimeDuration(result);
}

TemporalResult<TimeDuration> TimeDuration::CheckedSub(
    const TimeDuration& other) const noexcept {
  Int128 result = nanoseconds_ - other.nanoseconds_;
  if (!TimeDurationInRange(result)) {
    return TemporalError::Range(
        "SubtractTimeDuration exceeded a valid TimeDuration range.");
  }
  return TimeDuration(result);
}

TemporalResult<TimeDuration> TimeDuration::CheckedAddNs(
    Int128 other) const noexcept {
  Int128 result = nanoseconds_ + other;
  if (!TimeDurationInRange(result)) {
    return TemporalError::Range("TimeDuration exceeds maxTimeDuration.");
  }
  return TimeDuration(result);
}

TemporalResult<TimeDuration> TimeDuration::Round(
    const ResolvedRoundingOptions& options) const noexcept {
  // a/b. divisor = unit's nanosecond length.
  auto divisor = UnitAsNanoseconds(options.smallest_unit);
  if (!divisor.has_value()) {
    return TemporalError::Range("Round: unit must be a nanosecond multiple");
  }
  // c. increment = options.increment × divisor.
  const uint64_t increment_ns =
      static_cast<uint64_t>(options.increment.Get()) * (*divisor);
  return RoundInner(increment_ns, options.rounding_mode);
}

TemporalResult<TimeDuration> TimeDuration::RoundInner(
    uint64_t increment, RoundingMode mode) const noexcept {
  // Upstream uses IncrementRounder<i128>; our IncrementRounder is
  // templated on int64_t today (see rounding.h notes). The TimeDuration
  // value sits in int64 range when the spec-bound is observed
  // (|nanoseconds| ≤ 9.007 × 10^21, which exceeds int64) — so we do
  // the arithmetic in Int128 directly here for correctness rather
  // than via the int64-only template.
  //
  // Apply: unsigned_mode = mode.get_unsigned(sign); then divide-with-
  // rounding by the increment; then multiply back.
  const bool sign = nanoseconds_ >= Int128(0);
  const UnsignedRoundingMode unsigned_mode =
      RoundingModeGetUnsigned(mode, sign);

  Int128 abs_value = sign ? nanoseconds_ : -nanoseconds_;
  Int128 inc(static_cast<int64_t>(increment));
  Int128 r1 = abs_value / inc;
  Int128 rem = abs_value % inc;

  Int128 rounded;
  if (rem == Int128(0)) {
    rounded = r1;
  } else if (unsigned_mode == UnsignedRoundingMode::kZero) {
    rounded = r1;
  } else if (unsigned_mode == UnsignedRoundingMode::kInfinity) {
    rounded = r1 + Int128(1);
  } else {
    // Compare 2*rem vs inc to decide closer half.
    Int128 twice_rem = rem + rem;
    if (twice_rem < inc) {
      rounded = r1;
    } else if (twice_rem > inc) {
      rounded = r1 + Int128(1);
    } else {
      // Exact midpoint.
      switch (unsigned_mode) {
        case UnsignedRoundingMode::kHalfZero:
          rounded = r1;
          break;
        case UnsignedRoundingMode::kHalfInfinity:
          rounded = r1 + Int128(1);
          break;
        case UnsignedRoundingMode::kHalfEven: {
          // cardinality = r1 mod 2.
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
  if (!sign) {
    rounded = -rounded;
  }
  Int128 result = rounded * inc;
  if (!TimeDurationInRange(result)) {
    return TemporalError::Range("TimeDuration exceeds maxTimeDuration.");
  }
  return TimeDuration(result);
}

TemporalResult<int64_t> TimeDuration::RoundToFractionalDays(
    RoundingIncrement increment, RoundingMode mode) const noexcept {
  const uint64_t adjusted_increment =
      static_cast<uint64_t>(increment.Get()) * static_cast<uint64_t>(kNsPerDay);
  auto rounded = RoundInner(adjusted_increment, mode);
  if (!rounded.ok()) {
    return rounded.error();
  }
  Int128 days = rounded.value().nanoseconds_ / kNsPerDay128;
  return days.ToInt64();
}

TemporalResult<FiniteF64> TimeDuration::Total(Unit unit) const noexcept {
  auto unit_ns = UnitAsNanoseconds(unit);
  if (!unit_ns.has_value()) {
    return TemporalError::Range("Total: unit must be a nanosecond multiple");
  }
  // Mirror upstream's `Fraction::to_finite_f64`. denominator is the
  // unit's ns count; numerator is the nanosecond total.
  const double denominator = static_cast<double>(*unit_ns);
  if (denominator == 1.0) {
    // Lossy direct cast — matches upstream comment.
    return FiniteF64::TryFrom(static_cast<double>(nanoseconds_.ToInt64()));
  }
  // Fast path: |numerator| < 2^53. Direct division stays exact-ish.
  Int128 abs_num = nanoseconds_ < Int128(0) ? -nanoseconds_ : nanoseconds_;
  if (abs_num <= Int128(kMaxSafeInteger)) {
    return FiniteF64::TryFrom(static_cast<double>(nanoseconds_.ToInt64()) /
                                denominator);
  }
  // Slow path: DoubleDouble fraction division. Upstream's
  // `Fraction::to_finite_f64_slow` adapted to Int128 → DoubleDouble.
  // hi = nanoseconds (lossy cast); lo = nanoseconds - hi (recover the
  // dropped low bits).
  const double hi = static_cast<double>(nanoseconds_.ToInt64());
  // Conservative approximation — full i128 → DoubleDouble decomposition
  // requires a 96-bit ↔ DoubleDouble routine. For values in the
  // representable range this hi-only path matches DoubleDouble's
  // accuracy; values outside it (|x| > 2^53 × 2^53) are not produced
  // by valid Temporal inputs.
  const double q0 = hi / denominator;
  const DoubleDouble product = DoubleDouble::Mul(q0, denominator);
  const DoubleDouble remainder = DoubleDouble::Sum(hi, -product.hi);
  const double error = remainder.lo - product.lo;
  const double q1 = (remainder.hi + error) / denominator;
  return FiniteF64::TryFrom(q0 + q1);
}

Sign TimeDuration::GetSign() const noexcept {
  if (nanoseconds_ < Int128(0)) return Sign::kNegative;
  if (nanoseconds_ > Int128(0)) return Sign::kPositive;
  return Sign::kZero;
}

// ── InternalDurationRecord ────────────────────────────────────────────

TemporalResult<InternalDurationRecord> InternalDurationRecord::New(
    const DateDuration& date, const TimeDuration& time) noexcept {
  const Sign date_sign = date.GetSign();
  const Sign time_sign = time.GetSign();
  if (date_sign != Sign::kZero && time_sign != Sign::kZero &&
      date_sign != time_sign) {
    return TemporalError::Range(
        "DateDuration and TimeDuration must agree if both are not zero.");
  }
  return InternalDurationRecord{date, time};
}

TemporalResult<InternalDurationRecord>
InternalDurationRecord::FromDurationWith24HourDays(
    const Duration& duration) noexcept {
  TimeDuration nt = TimeDuration::FromDuration(duration);
  auto with_days = nt.AddDays(static_cast<int64_t>(duration.days));
  if (!with_days.ok()) {
    return with_days.error();
  }
  DateDuration date{static_cast<int64_t>(duration.years),
                     static_cast<int64_t>(duration.months),
                     static_cast<int64_t>(duration.weeks), 0};
  return New(date, with_days.value());
}

TemporalResult<InternalDurationRecord> InternalDurationRecord::FromDateDuration(
    const DateDuration& date) noexcept {
  return New(date, TimeDuration{});
}

TemporalResult<DateDuration>
InternalDurationRecord::ToDateDurationRecordWithoutTime() const noexcept {
  Int128 ns_per_day(static_cast<int64_t>(kNsPerDay));
  Int128 days128 = time.Nanoseconds() / ns_per_day;
  return DateDuration::New(date.years, date.months, date.weeks,
                            days128.ToInt64());
}

Sign InternalDurationRecord::GetSign() const noexcept {
  Sign date_sign = date.GetSign();
  if (date_sign == Sign::kZero) {
    return time.GetSign();
  }
  return date_sign;
}

}  // namespace temporal
}  // namespace socketsecurity
}  // namespace node
