// Compat shim: temporal_rs::Sign. Maps onto our
// node::socketsecurity::temporal::Sign 1:1.

#ifndef TEMPORAL_RS_COMPAT_SIGN_HPP_
#define TEMPORAL_RS_COMPAT_SIGN_HPP_

#include "socketsecurity/temporal/duration_normalized.h"

namespace temporal_rs {

class Sign {
 public:
  // Upstream's `Sign` is signed (-1, 0, 1) to allow direct use as an
  // i8 multiplier. Same encoding here.
  enum Value : int8_t {
    Negative = -1,
    Zero = 0,
    Positive = 1,
  };

  constexpr Sign() : value_(Zero) {}
  constexpr Sign(Value v) : value_(v) {}
  constexpr operator Value() const { return value_; }
  explicit operator bool() const = delete;

  // Bridge from temporal-infra's Sign (also -1/0/1 — encoded the
  // same on the wire).
  static constexpr Sign FromInfra(
      ::node::socketsecurity::temporal::Sign s) {
    using Infra = ::node::socketsecurity::temporal::Sign;
    switch (s) {
      case Infra::kNegative:
        return Negative;
      case Infra::kZero:
        return Zero;
      case Infra::kPositive:
        return Positive;
    }
    return Zero;
  }

  constexpr ::node::socketsecurity::temporal::Sign ToInfra() const {
    using Infra = ::node::socketsecurity::temporal::Sign;
    switch (value_) {
      case Negative:
        return Infra::kNegative;
      case Zero:
        return Infra::kZero;
      case Positive:
        return Infra::kPositive;
    }
    return Infra::kZero;
  }

 private:
  Value value_;
};

}  // namespace temporal_rs

#endif  // TEMPORAL_RS_COMPAT_SIGN_HPP_
