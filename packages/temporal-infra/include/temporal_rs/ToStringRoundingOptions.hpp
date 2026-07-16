// Compat shim: temporal_rs::ToStringRoundingOptions.

#ifndef TEMPORAL_RS_COMPAT_TOSTRINGROUNDINGOPTIONS_HPP_
#define TEMPORAL_RS_COMPAT_TOSTRINGROUNDINGOPTIONS_HPP_

#include <optional>

#include "socketsecurity/temporal/options.h"
#include "temporal_rs/Precision.hpp"
#include "temporal_rs/RoundingMode.hpp"
#include "temporal_rs/Unit.hpp"

namespace temporal_rs {

struct ToStringRoundingOptions {
  Precision precision;
  std::optional<Unit> smallest_unit;
  std::optional<RoundingMode> rounding_mode;

  ::node::socketsecurity::temporal::ToStringRoundingOptions ToInfra() const {
    ::node::socketsecurity::temporal::ToStringRoundingOptions out;
    out.precision = precision.ToInfra();
    if (smallest_unit.has_value()) {
      out.smallest_unit = smallest_unit->ToInfra();
    }
    if (rounding_mode.has_value()) {
      out.rounding_mode = rounding_mode->ToInfra();
    }
    return out;
  }
};

}  // namespace temporal_rs

#endif  // TEMPORAL_RS_COMPAT_TOSTRINGROUNDINGOPTIONS_HPP_
