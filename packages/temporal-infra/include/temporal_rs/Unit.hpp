// Compat shim: temporal_rs::Unit. Maps onto our
// node::socketsecurity::temporal::Unit. Numeric values match
// upstream (Auto=0, Nanosecond=1, …, Year=10) so direct
// comparison-by-magnitude works without any translation.

#ifndef TEMPORAL_RS_COMPAT_UNIT_HPP_
#define TEMPORAL_RS_COMPAT_UNIT_HPP_

#include "socketsecurity/temporal/options.h"

namespace temporal_rs {

class Unit {
 public:
  enum Value : uint8_t {
    Auto = 0,
    Nanosecond = 1,
    Microsecond = 2,
    Millisecond = 3,
    Second = 4,
    Minute = 5,
    Hour = 6,
    Day = 7,
    Week = 8,
    Month = 9,
    Year = 10,
  };

  constexpr Unit() : value_(Auto) {}
  constexpr Unit(Value v) : value_(v) {}
  constexpr operator Value() const { return value_; }
  explicit operator bool() const = delete;

  constexpr ::node::socketsecurity::temporal::Unit ToInfra() const {
    return static_cast<::node::socketsecurity::temporal::Unit>(value_);
  }

  static constexpr Unit FromInfra(
      ::node::socketsecurity::temporal::Unit u) {
    return Unit(static_cast<Value>(u));
  }

 private:
  Value value_;
};

}  // namespace temporal_rs

#endif  // TEMPORAL_RS_COMPAT_UNIT_HPP_
