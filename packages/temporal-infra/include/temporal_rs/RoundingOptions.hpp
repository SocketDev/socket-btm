// Compat shim: temporal_rs::RoundingOptions.

#ifndef TEMPORAL_RS_COMPAT_ROUNDINGOPTIONS_HPP_
#define TEMPORAL_RS_COMPAT_ROUNDINGOPTIONS_HPP_

#include <cstdint>
#include <optional>

#include "socketsecurity/temporal/options.h"
#include "temporal_rs/RoundingMode.hpp"
#include "temporal_rs/Unit.hpp"

namespace temporal_rs {

struct RoundingOptions {
  std::optional<Unit> largest_unit;
  std::optional<Unit> smallest_unit;
  std::optional<RoundingMode> rounding_mode;
  std::optional<uint32_t> increment;

  ::node::socketsecurity::temporal::RoundingOptions ToInfra() const {
    ::node::socketsecurity::temporal::RoundingOptions out;
    if (largest_unit.has_value()) {
      out.largest_unit = largest_unit->ToInfra();
    }
    if (smallest_unit.has_value()) {
      out.smallest_unit = smallest_unit->ToInfra();
    }
    if (rounding_mode.has_value()) {
      out.rounding_mode = rounding_mode->ToInfra();
    }
    if (increment.has_value()) {
      auto r = ::node::socketsecurity::temporal::RoundingIncrement::TryNew(
          *increment);
      if (r.ok()) {
        out.increment = r.value();
      }
    }
    return out;
  }
};

}  // namespace temporal_rs

#endif  // TEMPORAL_RS_COMPAT_ROUNDINGOPTIONS_HPP_
