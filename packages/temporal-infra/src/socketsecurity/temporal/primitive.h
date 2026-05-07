// 1:1 port of upstream `src/primitive.rs` at temporal v0.2.3
// (c003cc92325e19b26f8ee2f85e4a47d98cbcc781).
//
// Lock-step from Rust: primitive.rs
//
// FiniteF64: a thin double wrapper that rejects NaN / +inf / -inf at the
// boundary (mirrors the spec's IsFinite check). DoubleDouble: an
// internal double-precision pair used for high-precision multiplication
// during duration math.

#ifndef SRC_SOCKETSECURITY_TEMPORAL_PRIMITIVE_H_
#define SRC_SOCKETSECURITY_TEMPORAL_PRIMITIVE_H_

#include <cmath>
#include <cstdint>
#include <limits>

#include "socketsecurity/temporal/error.h"

namespace node {
namespace socketsecurity {
namespace temporal {

// Mirror of upstream's `FiniteF64`. Default value is +0.0 (matches Rust
// `Default::default()`). Constructed via TryFrom; direct construction
// from a non-finite value is forbidden.
class FiniteF64 {
 public:
  constexpr FiniteF64() noexcept : value_(0.0) {}

  // Constructs from any integer (always finite, no error path needed).
  // Mirrors upstream's `From<i8/i16/i32/u8/u16/u32>`.
  template <typename T>
  static constexpr FiniteF64 FromInt(T value) noexcept {
    return FiniteF64(static_cast<double>(value));
  }

  // Mirrors upstream's `TryFrom<f64>`. Rejects NaN and infinities.
  static TemporalResult<FiniteF64> TryFrom(double value) noexcept {
    if (!std::isfinite(value)) {
      return TemporalError::Range("Number is not finite");
    }
    return FiniteF64(value);
  }

  // Mirrors upstream's `TryFrom<i64>`. Lossless for |value| <= 2^53.
  // Beyond that the conversion silently rounds — same as Rust + spec.
  static TemporalResult<FiniteF64> TryFromI64(int64_t value) noexcept {
    return FiniteF64(static_cast<double>(value));
  }

  constexpr double AsInner() const noexcept { return value_; }
  constexpr bool IsZero() const noexcept { return value_ == 0.0; }

  // Negate: Rust uses `-0.0` semantics carefully; we follow the same
  // path (do not flip the sign of zero).
  FiniteF64 Negate() const noexcept {
    if (!IsZero()) {
      return FiniteF64(-value_);
    }
    return *this;
  }

  FiniteF64 Abs() const noexcept {
    return FiniteF64(std::abs(value_));
  }

  TemporalResult<FiniteF64> CheckedAdd(const FiniteF64& other) const noexcept {
    const double r = value_ + other.value_;
    if (!std::isfinite(r)) {
      return TemporalError::Range("Number is not finite");
    }
    return FiniteF64(r);
  }

  // Upstream uses fused-multiply-add (`mul_add(a, b, c) = a*b + c`).
  // We use std::fma for the same numerical guarantees.
  TemporalResult<FiniteF64> CheckedMulAdd(const FiniteF64& a,
                                          const FiniteF64& b) const noexcept {
    const double r = std::fma(value_, a.value_, b.value_);
    if (!std::isfinite(r)) {
      return TemporalError::Range("Number is not finite");
    }
    return FiniteF64(r);
  }

  TemporalResult<FiniteF64> CheckedDiv(const FiniteF64& other) const noexcept {
    const double r = value_ / other.value_;
    if (!std::isfinite(r)) {
      return TemporalError::Range("Number is not finite");
    }
    return FiniteF64(r);
  }

  // copysign: skip when self is zero (preserves +0/-0 invariants).
  FiniteF64 CopySign(double other) const noexcept {
    if (!IsZero()) {
      return FiniteF64(std::copysign(value_, other));
    }
    return *this;
  }

  // Returns an integer of type T iff value is integral. Otherwise Range
  // error. Mirrors upstream's `as_integer_if_integral<T>`.
  template <typename T>
  TemporalResult<T> AsIntegerIfIntegral() const noexcept {
    if (value_ != std::trunc(value_)) {
      return TemporalError::Range("Number is not integral");
    }
    return static_cast<T>(value_);
  }

  // Truncate-to-T with clamping. Mirrors upstream's
  // `as_integer_with_truncation<T>`. Rust uses num_traits::clamp; we
  // clamp manually against numeric_limits.
  template <typename T>
  T AsIntegerWithTruncation() const noexcept {
    constexpr double kMin = static_cast<double>(std::numeric_limits<T>::min());
    constexpr double kMax = static_cast<double>(std::numeric_limits<T>::max());
    double v = value_;
    if (v < kMin) v = kMin;
    if (v > kMax) v = kMax;
    return static_cast<T>(v);
  }

  // Truncate-to-T then assert > 0. Mirrors upstream's
  // `as_positive_integer_with_truncation<T>`.
  template <typename T>
  TemporalResult<T> AsPositiveIntegerWithTruncation() const noexcept {
    const T t = AsIntegerWithTruncation<T>();
    if (t <= T{0}) {
      return TemporalError::Range("Number is not positive");
    }
    return t;
  }

  // Comparison ops. PartialOrd in Rust degrades to Ordering::Equal on
  // NaN; FiniteF64 forbids NaN at construction so total order holds.
  constexpr bool operator==(const FiniteF64& other) const noexcept {
    return value_ == other.value_;
  }
  constexpr bool operator!=(const FiniteF64& other) const noexcept {
    return value_ != other.value_;
  }
  constexpr bool operator<(const FiniteF64& other) const noexcept {
    return value_ < other.value_;
  }
  constexpr bool operator<=(const FiniteF64& other) const noexcept {
    return value_ <= other.value_;
  }
  constexpr bool operator>(const FiniteF64& other) const noexcept {
    return value_ > other.value_;
  }
  constexpr bool operator>=(const FiniteF64& other) const noexcept {
    return value_ >= other.value_;
  }

 private:
  // Private direct ctor — finiteness is invariant after TryFrom.
  explicit constexpr FiniteF64(double value) noexcept : value_(value) {}
  double value_;
};

// Mirror of upstream's pub(crate) `DoubleDouble`: a (hi, lo) pair where
// `hi + lo` represents the value with extra precision. Used by duration
// math to avoid rounding loss during multiplication of large nanosecond
// counts.
struct DoubleDouble {
  double hi;
  double lo;

  // Mul: produce hi=a*b, lo=fma(a,b,-hi). Standard IEEE-754 trick.
  static DoubleDouble Mul(double a, double b) noexcept {
    const double product = a * b;
    const double error = std::fma(a, b, -product);
    return DoubleDouble{product, error};
  }

  // Sum: Knuth's two-sum. Computes lo as the rounding error of (a+b).
  static DoubleDouble Sum(double one, double two) noexcept {
    const double sum = one + two;
    const double calc_one = sum - one;
    const double calc_two = sum - two;
    const double two_roundoff = two - calc_one;
    const double one_roundoff = one - calc_two;
    const double error = one_roundoff + two_roundoff;
    return DoubleDouble{sum, error};
  }
};

}  // namespace temporal
}  // namespace socketsecurity
}  // namespace node

#endif  // SRC_SOCKETSECURITY_TEMPORAL_PRIMITIVE_H_
