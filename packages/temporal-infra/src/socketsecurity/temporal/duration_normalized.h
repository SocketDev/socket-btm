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

  // Mirror of upstream's `combine(date, time)`.
  static InternalDurationRecord Combine(const DateDuration& date,
                                          const TimeDuration& time) noexcept {
    return InternalDurationRecord{date, time};
  }
};

}  // namespace temporal
}  // namespace socketsecurity
}  // namespace node

#endif  // SRC_SOCKETSECURITY_TEMPORAL_DURATION_NORMALIZED_H_
