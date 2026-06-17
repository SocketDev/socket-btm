// Compat shim: temporal_rs::DisplayCalendar.

#ifndef TEMPORAL_RS_COMPAT_DISPLAYCALENDAR_HPP_
#define TEMPORAL_RS_COMPAT_DISPLAYCALENDAR_HPP_

#include "socketsecurity/temporal/options.h"

namespace temporal_rs {

class DisplayCalendar {
 public:
  enum Value {
    Auto = 0,
    Always = 1,
    Never = 2,
    Critical = 3,
  };

  constexpr DisplayCalendar() : value_(Auto) {}
  constexpr DisplayCalendar(Value v) : value_(v) {}
  constexpr operator Value() const { return value_; }
  explicit operator bool() const = delete;

  constexpr ::node::socketsecurity::temporal::DisplayCalendar ToInfra() const {
    using Infra = ::node::socketsecurity::temporal::DisplayCalendar;
    switch (value_) {
      case Auto:
        return Infra::kAuto;
      case Always:
        return Infra::kAlways;
      case Never:
        return Infra::kNever;
      case Critical:
        return Infra::kCritical;
    }
    return Infra::kAuto;
  }

  static constexpr DisplayCalendar FromInfra(
      ::node::socketsecurity::temporal::DisplayCalendar d) {
    using Infra = ::node::socketsecurity::temporal::DisplayCalendar;
    switch (d) {
      case Infra::kAuto:
        return Auto;
      case Infra::kAlways:
        return Always;
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

#endif  // TEMPORAL_RS_COMPAT_DISPLAYCALENDAR_HPP_
