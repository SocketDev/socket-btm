// Compat shim: temporal_rs::ErrorKind → maps onto our
// node::socketsecurity::temporal::ErrorKind 1:1.

#ifndef TEMPORAL_RS_COMPAT_ERRORKIND_HPP_
#define TEMPORAL_RS_COMPAT_ERRORKIND_HPP_

#include "socketsecurity/temporal/error.h"

namespace temporal_rs {

class ErrorKind {
 public:
  enum Value {
    Generic = 0,
    Type = 1,
    Range = 2,
    Syntax = 3,
    Assert = 4,
  };

  constexpr ErrorKind() : value_(Generic) {}
  constexpr ErrorKind(Value v) : value_(v) {}
  constexpr operator Value() const { return value_; }
  explicit operator bool() const = delete;

  // Bridge to/from temporal-infra's ErrorKind.
  static constexpr ErrorKind FromInfra(
      ::node::socketsecurity::temporal::ErrorKind k) {
    using Infra = ::node::socketsecurity::temporal::ErrorKind;
    switch (k) {
      case Infra::kGeneric:
        return Generic;
      case Infra::kType:
        return Type;
      case Infra::kRange:
        return Range;
      case Infra::kSyntax:
        return Syntax;
      case Infra::kAssert:
        return Assert;
    }
    return Generic;
  }

 private:
  Value value_;
};

}  // namespace temporal_rs

#endif  // TEMPORAL_RS_COMPAT_ERRORKIND_HPP_
