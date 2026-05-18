// 1:1 port of upstream `src/rounding.rs` at temporal v0.2.3
// (c003cc92325e19b26f8ee2f85e4a47d98cbcc781).
//
// Lock-step from Rust: rounding.rs
//
// Implements `IncrementRounder<T>` (the spec's
// RoundNumberToIncrement / RoundNumberToIncrementAsIfPositive) for
// signed integers and double. Upstream uses a Rust trait
// (`Roundable`) to share the rounding pipeline across i64/i128/f64;
// C++ uses a small free-function dispatch + a templated rounder.

#ifndef SRC_SOCKETSECURITY_TEMPORAL_ROUNDING_H_
#define SRC_SOCKETSECURITY_TEMPORAL_ROUNDING_H_

#include <cmath>
#include <cstdint>
#include <type_traits>

#include "socketsecurity/temporal/error.h"
#include "socketsecurity/temporal/options.h"
#include "socketsecurity/temporal/temporal_int128.h"

namespace node {
namespace socketsecurity {
namespace temporal {

namespace rounding_internal {

// Mirror of upstream's `Roundable::is_exact` for integral T.
template <typename T>
constexpr bool IsExactIntegral(T dividend, T divisor) noexcept {
  // Rust uses rem_euclid; we ensure divisor > 0 (caller's invariant).
  return dividend % divisor == 0;
}

inline bool IsExactF64(double dividend, double divisor) noexcept {
  const double q = std::abs(dividend / divisor);
  return q == std::floor(q);
}

// Mirror of upstream's `result_floor` for integral T. Caller's invariant
// is divisor > 0; for negative dividend, Rust's div_euclid floors away
// from zero, while C++ '/' truncates toward zero. We convert back via
// the standard `(d - r * v) / v` adjustment.
template <typename T>
constexpr int64_t ResultFloorIntegral(T dividend, T divisor) noexcept {
  // Use floor-division semantics matching Rust's div_euclid.
  const T q = dividend / divisor;
  const T r = dividend % divisor;
  // Adjust toward floor when remainder is non-zero and signs disagree.
  if ((r != T{0}) && ((r < T{0}) != (divisor < T{0}))) {
    return static_cast<int64_t>(q) - 1;
  }
  return static_cast<int64_t>(q);
}

inline int64_t ResultFloorF64(double dividend, double divisor) noexcept {
  // Upstream uses `Euclid::div_euclid(&dividend, &divisor) as i128`.
  // For doubles this is std::floor(dividend / divisor) when divisor > 0.
  return static_cast<int64_t>(std::floor(dividend / divisor));
}

// CompareRemainder: returns -1 if d < midpoint, +1 if d > midpoint, 0
// if exactly at midpoint. For integers, breaks ties when divisor is
// odd by reporting "less" — matches upstream's `compare_remainder`.
template <typename T>
constexpr int CompareRemainderIntegral(T dividend, T divisor) noexcept {
  // mid = divisor / 2 (Euclid). Caller ensures divisor > 0.
  const T midway = divisor / 2;
  // rem_euclid: if remainder is negative, add divisor.
  T rem = dividend % divisor;
  if (rem < T{0}) {
    rem += divisor;
  }
  if (rem < midway) {
    return -1;
  }
  if (rem > midway) {
    return 1;
  }
  // Equal — but if divisor is odd, treat as Less (upstream's
  // off-by-one for odd divisors: midway floors toward zero, so the
  // exact midpoint for an odd divisor lies between rem == midway and
  // rem == midway+1).
  if (divisor % 2 != T{0}) {
    return -1;
  }
  return 0;
}

inline int CompareRemainderF64(double dividend, double divisor) noexcept {
  const double q = dividend / divisor;
  const double d1 = q - std::floor(q);
  const double d2 = std::ceil(q) - q;
  if (d1 < d2) return -1;
  if (d1 > d2) return 1;
  return 0;
}

// IsEvenCardinal: result_floor(dividend, divisor) is even.
template <typename T>
constexpr bool IsEvenCardinalIntegral(T dividend, T divisor) noexcept {
  const int64_t f = ResultFloorIntegral<T>(dividend, divisor);
  // Even if `(f mod 2) == 0`. Use C++ truncating modulo on signed —
  // for negative even values f % 2 == 0; for negative odd values
  // f % 2 == -1 (truncating). Either way, comparison to 0 is correct.
  return f % 2 == 0;
}

inline bool IsEvenCardinalF64(double dividend, double divisor) noexcept {
  const double q = dividend / divisor;
  const double f = std::floor(q);
  // diff is the next-integer step (1.0 in the typical case). The
  // upstream comment computes (f / (ceil-floor)) % 2 == 0; we do the
  // same with std::fmod for the rare non-1 step.
  const double diff = std::ceil(q) - f;
  if (diff == 0.0) {
    // q is exactly an integer — cardinality is f mod 2.
    return std::fmod(f, 2.0) == 0.0;
  }
  return std::fmod(f / diff, 2.0) == 0.0;
}

// Apply the unsigned rounding mode for integral T. Returns the
// floored or ceil value as i64.
template <typename T>
constexpr int64_t ApplyUnsignedRoundingModeIntegral(
    T dividend, T divisor, UnsignedRoundingMode mode) noexcept {
  const int64_t r1 = ResultFloorIntegral<T>(dividend, divisor);
  const int64_t r2 = r1 + 1;
  if (IsExactIntegral<T>(dividend, divisor)) {
    return r1;
  }
  if (mode == UnsignedRoundingMode::kZero) return r1;
  if (mode == UnsignedRoundingMode::kInfinity) return r2;
  const int cmp = CompareRemainderIntegral<T>(dividend, divisor);
  if (cmp < 0) return r1;
  if (cmp > 0) return r2;
  // Equal at midpoint.
  if (mode == UnsignedRoundingMode::kHalfZero) return r1;
  if (mode == UnsignedRoundingMode::kHalfInfinity) return r2;
  // HalfEven.
  return IsEvenCardinalIntegral<T>(dividend, divisor) ? r1 : r2;
}

inline int64_t ApplyUnsignedRoundingModeF64(double dividend, double divisor,
                                              UnsignedRoundingMode mode) noexcept {
  const int64_t r1 = ResultFloorF64(dividend, divisor);
  const int64_t r2 = r1 + 1;
  if (IsExactF64(dividend, divisor)) {
    return r1;
  }
  if (mode == UnsignedRoundingMode::kZero) return r1;
  if (mode == UnsignedRoundingMode::kInfinity) return r2;
  const int cmp = CompareRemainderF64(dividend, divisor);
  if (cmp < 0) return r1;
  if (cmp > 0) return r2;
  if (mode == UnsignedRoundingMode::kHalfZero) return r1;
  if (mode == UnsignedRoundingMode::kHalfInfinity) return r2;
  return IsEvenCardinalF64(dividend, divisor) ? r1 : r2;
}

}  // namespace rounding_internal

// Mirror of upstream's `IncrementRounder<T>`. T may be int64_t or
// double. (Upstream supports i128 too; we use int64 here since the
// callers we have so far stay below 2^63.)
template <typename T>
class IncrementRounder {
 public:
  // Mirror of upstream's `from_signed_num(number, increment)`.
  // `increment` must be > 0; bool sign is derived from `number >= 0`.
  static TemporalResult<IncrementRounder<T>> FromSignedNum(
      T number, uint64_t increment) noexcept {
    if (increment == 0) {
      return TemporalError::Assert("increment must be > 0");
    }
    IncrementRounder<T> r;
    r.sign_ = (number >= T{0});
    r.dividend_ = number;
    r.divisor_ = static_cast<T>(increment);
    return r;
  }

  // Mirror of upstream's `round(mode)`.
  int64_t Round(RoundingMode mode) const noexcept {
    const UnsignedRoundingMode unsigned_mode =
        RoundingModeGetUnsigned(mode, sign_);
    T dividend = dividend_;
    if (!sign_) {
      dividend = T{0} - dividend;
    }
    int64_t rounded;
    if constexpr (std::is_same_v<T, double>) {
      rounded = rounding_internal::ApplyUnsignedRoundingModeF64(
          dividend, divisor_, unsigned_mode);
    } else {
      rounded = rounding_internal::ApplyUnsignedRoundingModeIntegral<T>(
          dividend, divisor_, unsigned_mode);
    }
    if (!sign_) {
      rounded = -rounded;
    }
    // saturating_mul. For our caller domain int64 is sufficient.
    return rounded * static_cast<int64_t>(divisor_);
  }

  // Mirror of upstream's `round_as_if_positive(mode)`.
  int64_t RoundAsIfPositive(RoundingMode mode) const noexcept {
    const UnsignedRoundingMode unsigned_mode =
        RoundingModeGetUnsigned(mode, true);
    int64_t rounded;
    if constexpr (std::is_same_v<T, double>) {
      rounded = rounding_internal::ApplyUnsignedRoundingModeF64(
          dividend_, divisor_, unsigned_mode);
    } else {
      rounded = rounding_internal::ApplyUnsignedRoundingModeIntegral<T>(
          dividend_, divisor_, unsigned_mode);
    }
    return rounded * static_cast<int64_t>(divisor_);
  }

 private:
  IncrementRounder() = default;
  bool sign_ = true;
  T dividend_{};
  T divisor_{};
};

}  // namespace temporal
}  // namespace socketsecurity
}  // namespace node

#endif  // SRC_SOCKETSECURITY_TEMPORAL_ROUNDING_H_
