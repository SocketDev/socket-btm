// Compat shim: temporal_rs::DisplayOffset.

#ifndef TEMPORAL_RS_COMPAT_DISPLAYOFFSET_HPP_
#define TEMPORAL_RS_COMPAT_DISPLAYOFFSET_HPP_

#include "socketsecurity/temporal/options.h"

namespace temporal_rs {

class DisplayOffset {
 public:
  enum Value {
    Auto = 0,
    Never = 1,
  };

  constexpr DisplayOffset() : value_(Auto) {}
  constexpr DisplayOffset(Value v) : value_(v) {}
  constexpr operator Value() const { return value_; }
  explicit operator bool() const = delete;

  constexpr ::node::socketsecurity::temporal::DisplayOffset ToInfra() const {
    using Infra = ::node::socketsecurity::temporal::DisplayOffset;
    return value_ == Never ? Infra::kNever : Infra::kAuto;
  }

  static constexpr DisplayOffset FromInfra(
      ::node::socketsecurity::temporal::DisplayOffset d) {
    return d == ::node::socketsecurity::temporal::DisplayOffset::kNever
               ? Never
               : Auto;
  }

 private:
  Value value_;
};

}  // namespace temporal_rs

#endif  // TEMPORAL_RS_COMPAT_DISPLAYOFFSET_HPP_
