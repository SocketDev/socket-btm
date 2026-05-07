// Compat shim: temporal_rs::PartialDate. Optional-fields struct used
// by PlainDate::from_partial / with. Bridges to temporal-infra's
// `PartialDate` (which omits the calendar-extension fields era /
// era_year / month_code; those land with calendar.cc Phase 11).

#ifndef TEMPORAL_RS_COMPAT_PARTIALDATE_HPP_
#define TEMPORAL_RS_COMPAT_PARTIALDATE_HPP_

#include <cstdint>
#include <optional>

#include "socketsecurity/temporal/plain_date.h"
#include "temporal_rs/AnyCalendarKind.hpp"

namespace temporal_rs {

struct PartialDate {
  std::optional<int32_t> year;
  std::optional<uint8_t> month;
  std::optional<uint8_t> day;
  // Calendar-extension fields (only meaningful for non-ISO
  // calendars). Stored here so V8 call sites can populate them
  // even though our temporal-infra PartialDate doesn't yet
  // consume them — the values flow through unchanged when the
  // backend activates.
  std::optional<uint8_t> month_code_first;  // 'M' / first byte
  std::optional<uint8_t> month_code_second;  // tens digit
  std::optional<uint8_t> month_code_third;  // ones digit
  std::optional<uint8_t> month_code_fourth;  // 'L' or 0
  std::optional<int32_t> era_year;
  // `era` is a short ASCII string upstream (`TinyAsciiStr<19>`);
  // we leave it as a flag for now until calendar.cc consumes it.
  bool has_era = false;

  AnyCalendarKind calendar;

  ::node::socketsecurity::temporal::PartialDate ToInfra() const {
    ::node::socketsecurity::temporal::PartialDate out;
    out.year = year;
    out.month = month;
    out.day = day;
    return out;
  }
};

}  // namespace temporal_rs

#endif  // TEMPORAL_RS_COMPAT_PARTIALDATE_HPP_
