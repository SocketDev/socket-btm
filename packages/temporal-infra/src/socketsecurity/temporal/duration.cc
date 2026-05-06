// Temporal.Duration — calendar-aware time interval.
//
// The duration's `[[*]]` slots are doubles per spec, but each must be
// an integer (no NaN, no Infinity, no fractional component). Sign
// agreement: all non-zero components must share the same sign.
//
// V8 already provides DurationRecord + IsValidDuration via
// js-temporal-helpers.h — those operate on V8's internal Maybe<>
// types. Our Duration::IsValid() is a plain C++ check that doesn't
// require a V8 Isolate, so it's callable from any context.

#include "socketsecurity/temporal/temporal.h"

#include <cmath>
#include <cstdint>

namespace node {
namespace socketsecurity {
namespace temporal {

namespace {

// Spec helper: a double that's a finite, non-NaN integer.
bool IsIntegralDouble(double v) noexcept {
  if (std::isnan(v) || std::isinf(v)) {
    return false;
  }
  return std::trunc(v) == v;
}

// Spec helper: returns -1, 0, or +1 based on the sign of v. Treats
// `-0.0` as `0` per Temporal's "negative zero is positive zero"
// convention (spec's DurationSign).
int Sign(double v) noexcept {
  if (v > 0.0) {
    return 1;
  }
  if (v < 0.0) {
    return -1;
  }
  return 0;
}

}  // namespace

bool Duration::IsValid() const noexcept {
  // Spec: IsValidDuration(years, months, weeks, days, hours, minutes,
  //                       seconds, milliseconds, microseconds, nanoseconds)
  //
  // 1. Set sign to ! DurationSign(...).
  // 2. For each component v: if !IsIntegralNumber(v) return false.
  // 3. For each component v: if !v.IsZero() and !SameSign(v, sign), return false.
  // 4. If abs(years) >= 2^32 return false. (Same for months, weeks.)
  // 5. Compute totalNanoseconds for time components; if it doesn't fit
  //    in MAX_SAFE_INTEGER (2^53 - 1), return false.

  const double components[] = {years,         months,       weeks,
                               days,          hours,        minutes,
                               seconds,       milliseconds, microseconds,
                               nanoseconds};

  for (double v : components) {
    if (!IsIntegralDouble(v)) {
      return false;
    }
  }

  // Establish overall sign from the first non-zero component (spec's
  // DurationSign). All other non-zero components must match.
  int overall_sign = 0;
  for (double v : components) {
    int s = Sign(v);
    if (s != 0) {
      overall_sign = s;
      break;
    }
  }
  if (overall_sign != 0) {
    for (double v : components) {
      int s = Sign(v);
      if (s != 0 && s != overall_sign) {
        return false;
      }
    }
  }

  // Calendar component magnitudes capped at 2^32 per spec.
  const double kCalendarMax = 4294967296.0;  // 2^32
  if (std::abs(years) >= kCalendarMax) {
    return false;
  }
  if (std::abs(months) >= kCalendarMax) {
    return false;
  }
  if (std::abs(weeks) >= kCalendarMax) {
    return false;
  }

  // Time-only nanosecond magnitude ≤ MAX_SAFE_INTEGER (2^53 - 1).
  // Compute as a double — the spec deliberately uses float math here
  // because the inputs are spec'd as doubles. Overflow is detected
  // via the Number.MAX_SAFE_INTEGER check, not by integer overflow.
  const double kNsPerUs = 1000.0;
  const double kNsPerMs = 1000.0 * kNsPerUs;
  const double kNsPerSec = 1000.0 * kNsPerMs;
  const double kNsPerMin = 60.0 * kNsPerSec;
  const double kNsPerHour = 60.0 * kNsPerMin;
  const double kNsPerDay = 24.0 * kNsPerHour;

  const double total_ns = days * kNsPerDay + hours * kNsPerHour +
                          minutes * kNsPerMin + seconds * kNsPerSec +
                          milliseconds * kNsPerMs + microseconds * kNsPerUs +
                          nanoseconds;

  // Number.MAX_SAFE_INTEGER == 2^53 - 1 == 9007199254740991.
  // Spec: abs(totalNanoseconds) ≤ MAX_SAFE_INTEGER.
  const double kMaxSafe = 9007199254740991.0;
  if (std::abs(total_ns) > kMaxSafe) {
    return false;
  }

  return true;
}

}  // namespace temporal
}  // namespace socketsecurity
}  // namespace node
