// Compat shim: temporal_rs::ArithmeticOverflow → maps to our
// node::socketsecurity::temporal::Overflow. Spec value is "overflow"
// option (Constrain | Reject); upstream calls it ArithmeticOverflow.

#ifndef TEMPORAL_RS_COMPAT_ARITHMETICOVERFLOW_HPP_
#define TEMPORAL_RS_COMPAT_ARITHMETICOVERFLOW_HPP_

#include <cstdint>

#include "socketsecurity/temporal/options.h"

namespace temporal_rs {

class ArithmeticOverflow {
 public:
  enum Value : uint8_t {
    Constrain = 0,
    Reject = 1,
  };

  constexpr ArithmeticOverflow() : value_(Constrain) {}
  constexpr ArithmeticOverflow(Value v) : value_(v) {}
  constexpr operator Value() const { return value_; }
  explicit operator bool() const = delete;

  static constexpr ArithmeticOverflow FromInfra(
      ::node::socketsecurity::temporal::Overflow o) {
    using Infra = ::node::socketsecurity::temporal::Overflow;
    switch (o) {
      case Infra::kConstrain:
        return Constrain;
      case Infra::kReject:
        return Reject;
    }
    return Constrain;
  }

  constexpr ::node::socketsecurity::temporal::Overflow ToInfra() const {
    using Infra = ::node::socketsecurity::temporal::Overflow;
    switch (value_) {
      case Constrain:
        return Infra::kConstrain;
      case Reject:
        return Infra::kReject;
    }
    return Infra::kConstrain;
  }

 private:
  Value value_;
};

}  // namespace temporal_rs

#endif  // TEMPORAL_RS_COMPAT_ARITHMETICOVERFLOW_HPP_
