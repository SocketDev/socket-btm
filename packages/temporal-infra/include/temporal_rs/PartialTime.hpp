// Compat shim: temporal_rs::PartialTime. Optional time-fields struct.

#ifndef TEMPORAL_RS_COMPAT_PARTIALTIME_HPP_
#define TEMPORAL_RS_COMPAT_PARTIALTIME_HPP_

#include <cstdint>
#include <optional>

#include "socketsecurity/temporal/plain_time.h"

namespace temporal_rs {

struct PartialTime {
  std::optional<uint8_t> hour;
  std::optional<uint8_t> minute;
  std::optional<uint8_t> second;
  std::optional<uint16_t> millisecond;
  std::optional<uint16_t> microsecond;
  std::optional<uint16_t> nanosecond;

  ::node::socketsecurity::temporal::PartialTime ToInfra() const {
    ::node::socketsecurity::temporal::PartialTime out;
    out.hour = hour;
    out.minute = minute;
    out.second = second;
    out.millisecond = millisecond;
    out.microsecond = microsecond;
    out.nanosecond = nanosecond;
    return out;
  }
};

}  // namespace temporal_rs

#endif  // TEMPORAL_RS_COMPAT_PARTIALTIME_HPP_
