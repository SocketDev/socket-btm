// Compat shim: temporal_rs::PartialDate. Optional-fields struct used
// by PlainDate::from_partial / with. Bridges to temporal-infra's
// `PartialDate` (which omits the calendar-extension fields era /
// era_year / month_code; those land with calendar.cc Phase 11).
//
// The struct layout mirrors upstream's diplomat-generated shape so
// V8 can `temporal_rs::PartialDate{ .year = ..., .month_code = "",
// .era = "", ... }` aggregate-initialize directly.

#ifndef TEMPORAL_RS_COMPAT_PARTIALDATE_HPP_
#define TEMPORAL_RS_COMPAT_PARTIALDATE_HPP_

#include <cstdint>
#include <optional>
#include <string>

#include "socketsecurity/temporal/plain_date.h"
#include "temporal_rs/AnyCalendarKind.hpp"

namespace temporal_rs {

// `month_code` / `era` are `std::string` (not `std::string_view`) so
// they own the bytes. V8 assigns via `partial.month_code = optString.value()`
// — with a view here, the assignment would alias V8's temporary string,
// which is freed at the end of the enclosing statement. Owning the
// bytes eliminates the dangling-view risk (same shape as TemporalError
// and PartialZonedDateTime::offset).
struct PartialDate {
  std::optional<int32_t> year;
  std::optional<uint8_t> month;
  std::string month_code;
  std::optional<uint8_t> day;
  std::string era;
  std::optional<int32_t> era_year;
  AnyCalendarKind calendar;

  bool is_empty() const {
    return !year.has_value() && !month.has_value() && month_code.empty() &&
           !day.has_value() && era.empty() && !era_year.has_value();
  }

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
