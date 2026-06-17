// Compat shim: temporal_rs::Disambiguation. Maps onto our
// node::socketsecurity::temporal::Disambiguation.

#ifndef TEMPORAL_RS_COMPAT_DISAMBIGUATION_HPP_
#define TEMPORAL_RS_COMPAT_DISAMBIGUATION_HPP_

#include "socketsecurity/temporal/options.h"

namespace temporal_rs {

class Disambiguation {
 public:
  enum Value {
    Compatible = 0,
    Earlier = 1,
    Later = 2,
    Reject = 3,
  };

  constexpr Disambiguation() : value_(Compatible) {}
  constexpr Disambiguation(Value v) : value_(v) {}
  constexpr operator Value() const { return value_; }
  explicit operator bool() const = delete;

  constexpr ::node::socketsecurity::temporal::Disambiguation ToInfra() const {
    using Infra = ::node::socketsecurity::temporal::Disambiguation;
    switch (value_) {
      case Compatible:
        return Infra::kCompatible;
      case Earlier:
        return Infra::kEarlier;
      case Later:
        return Infra::kLater;
      case Reject:
        return Infra::kReject;
    }
    return Infra::kCompatible;
  }

  static constexpr Disambiguation FromInfra(
      ::node::socketsecurity::temporal::Disambiguation d) {
    using Infra = ::node::socketsecurity::temporal::Disambiguation;
    switch (d) {
      case Infra::kCompatible:
        return Compatible;
      case Infra::kEarlier:
        return Earlier;
      case Infra::kLater:
        return Later;
      case Infra::kReject:
        return Reject;
    }
    return Compatible;
  }

 private:
  Value value_;
};

}  // namespace temporal_rs

#endif  // TEMPORAL_RS_COMPAT_DISAMBIGUATION_HPP_
