// Compat shim: temporal_rs::RoundingMode.

#ifndef TEMPORAL_RS_COMPAT_ROUNDINGMODE_HPP_
#define TEMPORAL_RS_COMPAT_ROUNDINGMODE_HPP_

#include "socketsecurity/temporal/options.h"

namespace temporal_rs {

class RoundingMode {
 public:
  enum Value {
    Ceil = 0,
    Floor = 1,
    Expand = 2,
    Trunc = 3,
    HalfCeil = 4,
    HalfFloor = 5,
    HalfExpand = 6,
    HalfTrunc = 7,
    HalfEven = 8,
  };

  constexpr RoundingMode() : value_(HalfExpand) {}
  constexpr RoundingMode(Value v) : value_(v) {}
  constexpr operator Value() const { return value_; }
  explicit operator bool() const = delete;

  constexpr ::node::socketsecurity::temporal::RoundingMode ToInfra() const {
    using Infra = ::node::socketsecurity::temporal::RoundingMode;
    switch (value_) {
      case Ceil:
        return Infra::kCeil;
      case Floor:
        return Infra::kFloor;
      case Expand:
        return Infra::kExpand;
      case Trunc:
        return Infra::kTrunc;
      case HalfCeil:
        return Infra::kHalfCeil;
      case HalfFloor:
        return Infra::kHalfFloor;
      case HalfExpand:
        return Infra::kHalfExpand;
      case HalfTrunc:
        return Infra::kHalfTrunc;
      case HalfEven:
        return Infra::kHalfEven;
    }
    return Infra::kHalfExpand;
  }

  static constexpr RoundingMode FromInfra(
      ::node::socketsecurity::temporal::RoundingMode m) {
    using Infra = ::node::socketsecurity::temporal::RoundingMode;
    switch (m) {
      case Infra::kCeil:
        return Ceil;
      case Infra::kFloor:
        return Floor;
      case Infra::kExpand:
        return Expand;
      case Infra::kTrunc:
        return Trunc;
      case Infra::kHalfCeil:
        return HalfCeil;
      case Infra::kHalfFloor:
        return HalfFloor;
      case Infra::kHalfExpand:
        return HalfExpand;
      case Infra::kHalfTrunc:
        return HalfTrunc;
      case Infra::kHalfEven:
        return HalfEven;
    }
    return HalfExpand;
  }

 private:
  Value value_;
};

}  // namespace temporal_rs

#endif  // TEMPORAL_RS_COMPAT_ROUNDINGMODE_HPP_
