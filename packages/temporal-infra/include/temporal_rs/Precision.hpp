// Compat shim: temporal_rs::Precision. Three-state value: Auto
// (default), Minute (truncate at minute), or Digit(n) where n
// is 0..9 fractional digits.
//
// Upstream encodes this as `{is_minute: bool, precision:
// optional<u8>}` where:
//   is_minute=true, precision=nullopt  → Minute
//   is_minute=false, precision=nullopt → Auto
//   is_minute=false, precision=Some(n) → Digit(n)
//   (the {is_minute=true, precision=Some(n)} combination is invalid
//    by spec — upstream's invariant is enforced at construction.)
//
// Bridges to/from temporal-infra's `Precision` (which uses an enum
// + digits field).

#ifndef TEMPORAL_RS_COMPAT_PRECISION_HPP_
#define TEMPORAL_RS_COMPAT_PRECISION_HPP_

#include <cstdint>
#include <optional>

#include "socketsecurity/temporal/options.h"

namespace temporal_rs {

struct Precision {
  bool is_minute;
  std::optional<uint8_t> precision;

  // Convenience constructors matching the three valid states.
  static constexpr Precision Auto() {
    return Precision{false, std::nullopt};
  }
  static constexpr Precision Minute() {
    return Precision{true, std::nullopt};
  }
  static constexpr Precision Digit(uint8_t n) {
    return Precision{false, n};
  }

  ::node::socketsecurity::temporal::Precision ToInfra() const {
    using Infra = ::node::socketsecurity::temporal::Precision;
    Infra out;
    if (is_minute) {
      out.kind = Infra::Kind::kMinute;
    } else if (precision.has_value()) {
      out.kind = Infra::Kind::kDigit;
      out.digits = *precision;
    } else {
      out.kind = Infra::Kind::kAuto;
    }
    return out;
  }

  static Precision FromInfra(
      const ::node::socketsecurity::temporal::Precision& p) {
    using Infra = ::node::socketsecurity::temporal::Precision;
    switch (p.kind) {
      case Infra::Kind::kAuto:
        return Auto();
      case Infra::Kind::kMinute:
        return Minute();
      case Infra::Kind::kDigit:
        return Digit(p.digits);
    }
    return Auto();
  }
};

}  // namespace temporal_rs

#endif  // TEMPORAL_RS_COMPAT_PRECISION_HPP_
