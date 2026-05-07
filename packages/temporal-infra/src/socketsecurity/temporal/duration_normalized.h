// 1:1 port of upstream `src/builtins/core/duration/normalized.rs` and
// `src/builtins/core/duration/date.rs` at temporal v0.2.3
// (c003cc92325e19b26f8ee2f85e4a47d98cbcc781).
//
// SCAFFOLD: defines DateDuration / TimeDuration / InternalDurationRecord
// structs + sign/abs/negate/from-components helpers. The arithmetic
// pipeline (round, balance, total, normalize) is the bulk of the port
// (~1.5k LOC) and lands in a separate phase — it depends on Int128
// helpers and the rounding.h template instantiations being plumbed
// through the larger duration math paths.

#ifndef SRC_SOCKETSECURITY_TEMPORAL_DURATION_NORMALIZED_H_
#define SRC_SOCKETSECURITY_TEMPORAL_DURATION_NORMALIZED_H_

#include <cstdint>

#include "socketsecurity/temporal/error.h"
#include "socketsecurity/temporal/options.h"
#include "socketsecurity/temporal/primitive.h"
#include "socketsecurity/temporal/temporal.h"
#include "socketsecurity/temporal/temporal_int128.h"

namespace node {
namespace socketsecurity {
namespace temporal {

// Mirror of upstream's `Sign` enum. Used by Duration sign-checking.
enum class Sign : int8_t {
  kNegative = -1,
  kZero = 0,
  kPositive = 1,
};

// Mirror of upstream's `DateDuration { years, months, weeks, days }`.
// The fields are i64 — calendar units don't need higher precision.
struct DateDuration {
  int64_t years = 0;
  int64_t months = 0;
  int64_t weeks = 0;
  int64_t days = 0;

  // Mirror of upstream's `DateDuration::new`.
  static TemporalResult<DateDuration> New(int64_t years, int64_t months,
                                            int64_t weeks,
                                            int64_t days) noexcept;

  DateDuration Negated() const noexcept {
    return DateDuration{-years, -months, -weeks, -days};
  }
  DateDuration Abs() const noexcept {
    return DateDuration{years < 0 ? -years : years,
                        months < 0 ? -months : months,
                        weeks < 0 ? -weeks : weeks, days < 0 ? -days : days};
  }
  Sign GetSign() const noexcept;
};

// Mirror of upstream's `TimeDuration(i128)` newtype. Stores total
// time-component as a single Int128 nanosecond value, with the
// invariant that `|nanoseconds| <= MAX_TIME_DURATION`
// (= 9_007_199_254_740_991_999_999_999).
class TimeDuration {
 public:
  constexpr TimeDuration() noexcept : nanoseconds_() {}
  explicit constexpr TimeDuration(Int128 nanoseconds) noexcept
      : nanoseconds_(nanoseconds) {}

  // Mirror of upstream's `from_components`.
  static TimeDuration FromComponents(int64_t hours, int64_t minutes,
                                       int64_t seconds, int64_t milliseconds,
                                       Int128 microseconds,
                                       Int128 nanoseconds) noexcept;

  // Mirror of upstream's `from_duration`.
  static TimeDuration FromDuration(const Duration& duration) noexcept;

  // Mirror of upstream's `from_nanosecond_difference`. Bounds-checks
  // the difference against MAX_TIME_DURATION.
  static TemporalResult<TimeDuration> FromNanosecondDifference(
      Int128 one, Int128 two) noexcept;

  // Mirror of upstream's `add_days`. Adds `days * NS_PER_DAY` to the
  // current value with overflow checking.
  TemporalResult<TimeDuration> AddDays(int64_t days) const noexcept;

  // Mirror of upstream's `truncated_divide`. Truncates toward zero.
  Int128 TruncatedDivide(uint64_t divisor) const noexcept;

  // Mirror of upstream's `divide(f64)`.
  double Divide(double divisor) const noexcept;

  // Mirror of upstream's `seconds()` / `subseconds()`. C++ `/` and `%`
  // truncate toward zero — same as upstream's non-Euclid path
  // (upstream comment: "non-euclid is required here for negative rounding").
  int64_t Seconds() const noexcept;
  int32_t Subseconds() const noexcept;

  // Mirror of upstream's `negate`.
  TimeDuration Negate() const noexcept { return TimeDuration(-nanoseconds_); }

  // Mirror of upstream's `checked_sub` / `checked_add(i128)` / Add op.
  // All bounds-check against MAX_TIME_DURATION.
  TemporalResult<TimeDuration> CheckedAdd(const TimeDuration& other) const noexcept;
  TemporalResult<TimeDuration> CheckedSub(const TimeDuration& other) const noexcept;
  TemporalResult<TimeDuration> CheckedAddNs(Int128 other) const noexcept;

  // Mirror of upstream's `round`. Routes through IncrementRounder.
  TemporalResult<TimeDuration> Round(
      const ResolvedRoundingOptions& options) const noexcept;

  // Mirror of upstream's `round_inner(NonZeroU128, RoundingMode)`.
  // Caller-prepared increment (already multiplied with the divisor).
  TemporalResult<TimeDuration> RoundInner(uint64_t increment,
                                            RoundingMode mode) const noexcept;

  // Mirror of upstream's `round_to_fractional_days`.
  TemporalResult<int64_t> RoundToFractionalDays(RoundingIncrement increment,
                                                  RoundingMode mode) const noexcept;

  // Mirror of upstream's `total(unit)`. Returns the duration expressed
  // in `unit`s as a FiniteF64. Lossy at extremes (denominator > 1
  // and numerator > 2^53); uses DoubleDouble for the slow path.
  TemporalResult<FiniteF64> Total(Unit unit) const noexcept;

  Int128 Nanoseconds() const noexcept { return nanoseconds_; }
  Sign GetSign() const noexcept;

 private:
  Int128 nanoseconds_;
};

// Mirror of upstream's `InternalDurationRecord { date, time }`.
struct InternalDurationRecord {
  DateDuration date;
  TimeDuration time;

  // Mirror of upstream's `default()` — all-zeros.
  static InternalDurationRecord Default() noexcept {
    return InternalDurationRecord{};
  }

  // Mirror of upstream's `combine(date, time)`. Asserts agreement of
  // signs; the assertion is documented but not enforced in the spec
  // (combine is the unchecked variant).
  static InternalDurationRecord Combine(const DateDuration& date,
                                          const TimeDuration& time) noexcept {
    return InternalDurationRecord{date, time};
  }

  // Mirror of upstream's `new(date, norm)`. Validates that signs
  // agree if both are non-zero.
  static TemporalResult<InternalDurationRecord> New(
      const DateDuration& date, const TimeDuration& time) noexcept;

  // Mirror of upstream's `from_duration_with_24_hour_days(duration)`.
  static TemporalResult<InternalDurationRecord> FromDurationWith24HourDays(
      const Duration& duration) noexcept;

  // Mirror of upstream's `from_date_duration(date)`.
  static TemporalResult<InternalDurationRecord> FromDateDuration(
      const DateDuration& date) noexcept;

  // Mirror of upstream's `to_date_duration_record_without_time`.
  TemporalResult<DateDuration> ToDateDurationRecordWithoutTime() const noexcept;

  // Mirror of upstream's `sign`.
  Sign GetSign() const noexcept;
};

// Mirror of upstream's `Duration::is_valid_duration` (free function).
// Used by Duration::IsValid and DateDuration::New.
bool IsValidDuration(int64_t years, int64_t months, int64_t weeks,
                     int64_t days, int64_t hours, int64_t minutes,
                     int64_t seconds, int64_t milliseconds,
                     Int128 microseconds, Int128 nanoseconds) noexcept;

}  // namespace temporal
}  // namespace socketsecurity
}  // namespace node

#endif  // SRC_SOCKETSECURITY_TEMPORAL_DURATION_NORMALIZED_H_
