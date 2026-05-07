// Compat shim: temporal_rs::DisplayTimeZone.

#ifndef TEMPORAL_RS_COMPAT_DISPLAYTIMEZONE_HPP_
#define TEMPORAL_RS_COMPAT_DISPLAYTIMEZONE_HPP_

#include "socketsecurity/temporal/options.h"

namespace temporal_rs {

class DisplayTimeZone {
 public:
  enum Value {
    Auto = 0,
    Never = 1,
    Critical = 2,
  };

  constexpr DisplayTimeZone() : value_(Auto) {}
  constexpr DisplayTimeZone(Value v) : value_(v) {}
  constexpr operator Value() const { return value_; }
  explicit operator bool() const = delete;

  constexpr ::node::socketsecurity::temporal::DisplayTimeZone ToInfra() const {
    using Infra = ::node::socketsecurity::temporal::DisplayTimeZone;
    switch (value_) {
      case Auto:
        return Infra::kAuto;
      case Never:
        return Infra::kNever;
      case Critical:
        return Infra::kCritical;
    }
    return Infra::kAuto;
  }

  static constexpr DisplayTimeZone FromInfra(
      ::node::socketsecurity::temporal::DisplayTimeZone d) {
    using Infra = ::node::socketsecurity::temporal::DisplayTimeZone;
    switch (d) {
      case Infra::kAuto:
        return Auto;
      case Infra::kNever:
        return Never;
      case Infra::kCritical:
        return Critical;
    }
    return Auto;
  }

 private:
  Value value_;
};

}  // namespace temporal_rs

#endif  // TEMPORAL_RS_COMPAT_DISPLAYTIMEZONE_HPP_
