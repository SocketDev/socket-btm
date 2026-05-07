// Compat shim: temporal_rs::PartialZonedDateTime. Optional-fields
// struct used by ZonedDateTime::from_partial / with.

#ifndef TEMPORAL_RS_COMPAT_PARTIALZONEDDATETIME_HPP_
#define TEMPORAL_RS_COMPAT_PARTIALZONEDDATETIME_HPP_

#include <optional>
#include <string>

#include "temporal_rs/AnyCalendarKind.hpp"
#include "temporal_rs/Disambiguation.hpp"
#include "temporal_rs/OffsetDisambiguation.hpp"
#include "temporal_rs/PartialDate.hpp"
#include "temporal_rs/PartialTime.hpp"

namespace temporal_rs {

struct PartialZonedDateTime {
  PartialDate date;
  PartialTime time;
  std::optional<std::string> time_zone;
  std::optional<std::string> offset;
  std::optional<AnyCalendarKind> calendar;
  std::optional<Disambiguation> disambiguation;
  std::optional<OffsetDisambiguation> offset_option;

  bool is_empty() const {
    return date.is_empty() && time.is_empty() && !time_zone && !offset &&
           !calendar && !disambiguation && !offset_option;
  }
};

}  // namespace temporal_rs

#endif  // TEMPORAL_RS_COMPAT_PARTIALZONEDDATETIME_HPP_
