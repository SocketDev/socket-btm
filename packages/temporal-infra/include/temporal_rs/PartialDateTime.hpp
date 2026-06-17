// Compat shim: temporal_rs::PartialDateTime. PartialDate +
// PartialTime composed.

#ifndef TEMPORAL_RS_COMPAT_PARTIALDATETIME_HPP_
#define TEMPORAL_RS_COMPAT_PARTIALDATETIME_HPP_

#include "socketsecurity/temporal/plain_date_time.h"
#include "temporal_rs/PartialDate.hpp"
#include "temporal_rs/PartialTime.hpp"

namespace temporal_rs {

struct PartialDateTime {
  PartialDate date;
  PartialTime time;

  ::node::socketsecurity::temporal::PartialDateTime ToInfra() const {
    return ::node::socketsecurity::temporal::PartialDateTime{
        date.ToInfra(), time.ToInfra()};
  }
};

}  // namespace temporal_rs

#endif  // TEMPORAL_RS_COMPAT_PARTIALDATETIME_HPP_
