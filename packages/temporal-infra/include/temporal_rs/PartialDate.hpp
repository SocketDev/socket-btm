// Compat shim: temporal_rs::PartialDate. Optional-fields struct used
// by PlainDate::from_partial / with. Bridges to temporal-infra's
// `PartialDate` (ISO-only) and the calendar-aware extension fields
// (era / era_year / month_code) carried alongside.
//
// The struct layout mirrors upstream's diplomat-generated shape so
// V8 can `temporal_rs::PartialDate{ .year = ..., .month_code = "",
// .era = "", ... }` aggregate-initialize directly.

#ifndef TEMPORAL_RS_COMPAT_PARTIALDATE_HPP_
#define TEMPORAL_RS_COMPAT_PARTIALDATE_HPP_

#include <cstdint>
#include <optional>
#include <string>

#include "socketsecurity/temporal/calendar.h"
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

  // ISO-only projection. Loses calendar-extension fields. Use for the
  // ISO calendar path, or in combination with ToInfraExtensions() for
  // non-ISO calendars (the calendar-aware infra entry takes both).
  ::node::socketsecurity::temporal::PartialDate ToInfra() const {
    ::node::socketsecurity::temporal::PartialDate out;
    out.year = year;
    out.month = month;
    out.day = day;
    return out;
  }

  // Calendar-extension fields packed for infra's
  // PlainDateFromPartialWithCalendar / equivalent. Caller pairs this
  // with ToInfra() — together they carry everything V8 sent in.
  struct InfraExtensions {
    ::node::socketsecurity::temporal::MonthCode month_code{};
    bool has_month_code = false;
    ::node::socketsecurity::temporal::Era era{};
    bool has_era = false;
    int32_t era_year = 0;
    bool has_era_year = false;
  };

  InfraExtensions ToInfraExtensions() const {
    InfraExtensions out;
    if (!month_code.empty()) {
      // Parse "Mxx" / "MxxL" into MonthCode bytes. Fixed 4-byte POD:
      // ['M', tens, ones, optional 'L' or 0].
      const size_t n = month_code.size();
      if (n == 3 || n == 4) {
        out.month_code.bytes[0] = static_cast<uint8_t>(month_code[0]);
        out.month_code.bytes[1] = static_cast<uint8_t>(month_code[1]);
        out.month_code.bytes[2] = static_cast<uint8_t>(month_code[2]);
        out.month_code.bytes[3] =
            n == 4 ? static_cast<uint8_t>(month_code[3]) : 0;
        out.has_month_code = true;
      }
      // Malformed month_code → leave has_month_code=false. The infra
      // layer will fall through to month (or error if both empty).
    }
    if (!era.empty()) {
      out.era = ::node::socketsecurity::temporal::Era::FromBytes(
          reinterpret_cast<const uint8_t*>(era.data()), era.size());
      out.has_era = true;
    }
    if (era_year.has_value()) {
      out.era_year = *era_year;
      out.has_era_year = true;
    }
    return out;
  }
};

}  // namespace temporal_rs

#endif  // TEMPORAL_RS_COMPAT_PARTIALDATE_HPP_
