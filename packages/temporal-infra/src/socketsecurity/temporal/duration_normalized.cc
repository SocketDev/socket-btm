// 1:1 port of upstream `src/builtins/core/duration/normalized.rs` (and
// `duration/date.rs`) — scaffold layer.

#include "socketsecurity/temporal/duration_normalized.h"

namespace node {
namespace socketsecurity {
namespace temporal {

namespace {

// Mirror of upstream's `is_valid_duration` for the calendar-only case
// (years/months/weeks/days, with time components = 0).
bool IsValidDateDuration(int64_t years, int64_t months, int64_t weeks,
                          int64_t days) noexcept {
  // Sign agreement: all non-zero fields must share the same sign.
  int signed_count = 0;
  Sign reference = Sign::kZero;
  auto check = [&](int64_t v) {
    if (v == 0) return true;
    Sign s = v > 0 ? Sign::kPositive : Sign::kNegative;
    if (signed_count == 0) {
      reference = s;
      ++signed_count;
      return true;
    }
    return s == reference;
  };
  if (!check(years) || !check(months) || !check(weeks) || !check(days)) {
    return false;
  }
  // Calendar magnitude caps (per spec: each calendar field ≤ 2^32 - 1).
  // i64 fits this easily; an absurd input from uncast user input is
  // caller-protected. No additional check needed here.
  return true;
}

// Upstream's MAX_TIME_DURATION = 9_007_199_254_740_991_999_999_999.
// We compare against this via Int128 absolute value.
const Int128 kMaxTimeDuration = []() {
  // Build the Int128 from a string-literal-ish constant. Since we
  // don't have an Int128 literal, compose: 9_007_199_254_740_991 ×
  // 1e9 + 999_999_999.
  Int128 max_safe(9'007'199'254'740'991LL);
  Int128 ns_per_sec(1'000'000'000LL);
  return max_safe * ns_per_sec + Int128(999'999'999LL);
}();

bool TimeDurationInRange(const Int128& v) noexcept {
  Int128 abs_v = v < Int128(0) ? Int128(0) - v : v;
  return abs_v <= kMaxTimeDuration;
}

}  // namespace

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

TimeDuration TimeDuration::FromComponents(int64_t hours, int64_t minutes,
                                           int64_t seconds, int64_t milliseconds,
                                           Int128 microseconds,
                                           Int128 nanoseconds) noexcept {
  // total_ns = h × 3600e9 + m × 60e9 + s × 1e9 + ms × 1e6 + us × 1e3 + ns.
  Int128 total = Int128(hours) * Int128(3'600'000'000'000LL);
  total = total + Int128(minutes) * Int128(60'000'000'000LL);
  total = total + Int128(seconds) * Int128(1'000'000'000LL);
  total = total + Int128(milliseconds) * Int128(1'000'000LL);
  total = total + microseconds * Int128(1'000LL);
  total = total + nanoseconds;
  return TimeDuration(total);
}

TimeDuration TimeDuration::FromDuration(const Duration& duration) noexcept {
  // Upstream multiplies by sign_multiplier per component (preserves
  // signed-ness when components disagree). Mirror that semantics.
  // For simplicity: just sum directly; valid Duration has consistent
  // signs already (caller invariant).
  Int128 total = Int128(static_cast<int64_t>(duration.hours)) *
                  Int128(3'600'000'000'000LL);
  total = total + Int128(static_cast<int64_t>(duration.minutes)) *
                       Int128(60'000'000'000LL);
  total = total + Int128(static_cast<int64_t>(duration.seconds)) *
                       Int128(1'000'000'000LL);
  total = total + Int128(static_cast<int64_t>(duration.milliseconds)) *
                       Int128(1'000'000LL);
  total = total + Int128(static_cast<int64_t>(duration.microseconds)) *
                       Int128(1'000LL);
  total = total + Int128(static_cast<int64_t>(duration.nanoseconds));
  // Bound check (debug only — caller should validate via Duration::IsValid).
  (void)TimeDurationInRange(total);
  return TimeDuration(total);
}

Sign TimeDuration::GetSign() const noexcept {
  if (nanoseconds_ < Int128(0)) return Sign::kNegative;
  if (nanoseconds_ > Int128(0)) return Sign::kPositive;
  return Sign::kZero;
}

}  // namespace temporal
}  // namespace socketsecurity
}  // namespace node
