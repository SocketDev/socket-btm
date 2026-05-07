// Compat shim: temporal_rs::OffsetDisambiguation.

#ifndef TEMPORAL_RS_COMPAT_OFFSETDISAMBIGUATION_HPP_
#define TEMPORAL_RS_COMPAT_OFFSETDISAMBIGUATION_HPP_

#include "socketsecurity/temporal/options.h"

namespace temporal_rs {

class OffsetDisambiguation {
 public:
  enum Value {
    Use = 0,
    Prefer = 1,
    Ignore = 2,
    Reject = 3,
  };

  constexpr OffsetDisambiguation() : value_(Use) {}
  constexpr OffsetDisambiguation(Value v) : value_(v) {}
  constexpr operator Value() const { return value_; }
  explicit operator bool() const = delete;

  constexpr ::node::socketsecurity::temporal::OffsetDisambiguation ToInfra()
      const {
    using Infra = ::node::socketsecurity::temporal::OffsetDisambiguation;
    switch (value_) {
      case Use:
        return Infra::kUse;
      case Prefer:
        return Infra::kPrefer;
      case Ignore:
        return Infra::kIgnore;
      case Reject:
        return Infra::kReject;
    }
    return Infra::kUse;
  }

  static constexpr OffsetDisambiguation FromInfra(
      ::node::socketsecurity::temporal::OffsetDisambiguation d) {
    using Infra = ::node::socketsecurity::temporal::OffsetDisambiguation;
    switch (d) {
      case Infra::kUse:
        return Use;
      case Infra::kPrefer:
        return Prefer;
      case Infra::kIgnore:
        return Ignore;
      case Infra::kReject:
        return Reject;
    }
    return Use;
  }

 private:
  Value value_;
};

}  // namespace temporal_rs

#endif  // TEMPORAL_RS_COMPAT_OFFSETDISAMBIGUATION_HPP_
