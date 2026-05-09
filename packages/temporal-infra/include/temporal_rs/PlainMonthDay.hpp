// Compat shim: temporal_rs::PlainMonthDay.

#ifndef TEMPORAL_RS_COMPAT_PLAINMONTHDAY_HPP_
#define TEMPORAL_RS_COMPAT_PLAINMONTHDAY_HPP_

#include <cstdint>
#include <memory>
#include <optional>
#include <string>
#include <string_view>

#include "socketsecurity/temporal/plain_date.h"
#include "socketsecurity/temporal/ixdtf_writer.h"
#include "socketsecurity/temporal/plain_month_day.h"
#include "temporal_rs/AnyCalendarKind.hpp"
#include "temporal_rs/ArithmeticOverflow.hpp"
#include "temporal_rs/Calendar.hpp"
#include "temporal_rs/DisplayCalendar.hpp"
#include "temporal_rs/ParsedDate.hpp"
#include "temporal_rs/PartialDate.hpp"
#include "temporal_rs/PlainDate.hpp"
#include "temporal_rs/Provider.hpp"
#include "temporal_rs/TemporalError.hpp"
#include "temporal_rs/diplomat_runtime.hpp"

namespace temporal_rs {

class PlainDate;

class PlainMonthDay {
 public:
  static diplomat::result<std::unique_ptr<PlainMonthDay>, TemporalError>
  try_new_iso(uint8_t month, uint8_t day,
                std::optional<int32_t> reference_year) {
    auto result = ::node::socketsecurity::temporal::PlainMonthDayTryNewIso(
        month, day, reference_year);
    if (!result.ok()) {
      return diplomat::Err<TemporalError>(
          TemporalError::FromInfra(result.error()));
    }
    return diplomat::Ok<std::unique_ptr<PlainMonthDay>>(
        std::unique_ptr<PlainMonthDay>(new PlainMonthDay(result.value())));
  }

  static diplomat::result<std::unique_ptr<PlainMonthDay>, TemporalError>
  from_utf8(std::string_view s) {
    auto result = ::node::socketsecurity::temporal::PlainMonthDayFromUtf8(
        reinterpret_cast<const uint8_t*>(s.data()), s.size());
    if (!result.ok()) {
      return diplomat::Err<TemporalError>(
          TemporalError::FromInfra(result.error()));
    }
    return diplomat::Ok<std::unique_ptr<PlainMonthDay>>(
        std::unique_ptr<PlainMonthDay>(new PlainMonthDay(result.value())));
  }

  static diplomat::result<std::unique_ptr<PlainMonthDay>, TemporalError>
  from_partial(PartialDate /*partial*/,
               std::optional<ArithmeticOverflow> /*overflow*/) {
    // Stub — full PartialDate → PlainMonthDay resolution lands when
    // the calendar-aware path activates.
    return diplomat::Ok<std::unique_ptr<PlainMonthDay>>(
        std::unique_ptr<PlainMonthDay>(nullptr));
  }

  static diplomat::result<std::unique_ptr<PlainMonthDay>, TemporalError>
  try_new_with_overflow(uint8_t /*month*/, uint8_t /*day*/,
                        AnyCalendarKind /*calendar*/,
                        ArithmeticOverflow /*overflow*/,
                        std::optional<int32_t> /*ref_year*/) {
    return diplomat::Ok<std::unique_ptr<PlainMonthDay>>(
        std::unique_ptr<PlainMonthDay>(nullptr));
  }

  diplomat::result<std::unique_ptr<PlainMonthDay>, TemporalError>
  with(PartialDate /*partial*/,
       std::optional<ArithmeticOverflow> /*overflow*/) const {
    return diplomat::Ok<std::unique_ptr<PlainMonthDay>>(
        std::unique_ptr<PlainMonthDay>(new PlainMonthDay(inner_)));
  }

  diplomat::result<std::unique_ptr<PlainDate>, TemporalError>
  to_plain_date(std::optional<PartialDate> /*year*/) const {
    return diplomat::Ok<std::unique_ptr<PlainDate>>(
        std::unique_ptr<PlainDate>(nullptr));
  }

  diplomat::result<int64_t, TemporalError>
  epoch_ms_for_with_provider(TimeZone /*tz*/, const Provider& /*p*/) const {
    return diplomat::Ok<int64_t>(0);
  }

  // 1:1 from upstream plain_month_day.rs:380 / :387.
  std::string to_ixdtf_string(DisplayCalendar display_calendar) const {
    ::node::socketsecurity::temporal::FormattableMonthDay fmd{
        ::node::socketsecurity::temporal::FormattableDate{
            inner_.iso.year, inner_.iso.month, inner_.iso.day},
        ::node::socketsecurity::temporal::FormattableCalendar{
            display_calendar.ToInfra(), "iso8601"}};
    return fmd.ToString();
  }

  static diplomat::result<std::unique_ptr<PlainMonthDay>, TemporalError>
  from_utf16(std::u16string_view s) {
    std::string narrow;
    narrow.reserve(s.size());
    for (char16_t c : s) {
      if (c > 0x7F) {
        return diplomat::Err<TemporalError>(TemporalError{
            ErrorKind::Range,
            "Non-ASCII character in PlainMonthDay string"});
      }
      narrow.push_back(static_cast<char>(c));
    }
    return from_utf8(narrow);
  }

  // Build a PlainMonthDay from a parsed record.
  static diplomat::result<std::unique_ptr<PlainMonthDay>, TemporalError>
  from_parsed(const ParsedDate& parsed) {
    auto r = ::node::socketsecurity::temporal::PlainMonthDayTryNewIso(
        parsed.month(), parsed.day(), std::optional<int32_t>{});
    if (!r.ok()) {
      return diplomat::Err<TemporalError>(
          TemporalError::FromInfra(r.error()));
    }
    return diplomat::Ok<std::unique_ptr<PlainMonthDay>>(
        std::unique_ptr<PlainMonthDay>(new PlainMonthDay(r.value())));
  }

  uint8_t month() const {
    return ::node::socketsecurity::temporal::PlainMonthDayMonth(inner_);
  }
  uint8_t day() const {
    return ::node::socketsecurity::temporal::PlainMonthDayDay(inner_);
  }
  bool is_valid() const { return inner_.IsValid(); }

  // Calendar-aware accessors. ISO defaults until calendar.cc lands.
  Calendar calendar() const {
    return Calendar(::node::socketsecurity::temporal::Calendar::Iso());
  }
  std::string month_code() const { return ""; }

  // Conversion: PlainMonthDay + year -> PlainDate. Templated so the
  // PlainDate.hpp / PlainMonthDay.hpp include cycle stays one-way.
  template <class PD>
  diplomat::result<std::unique_ptr<PD>, TemporalError> to_plain_date(
      const PD* /*reference_year_date*/) const {
    auto r = ::node::socketsecurity::temporal::PlainDateTryNewIso(
        inner_.iso.year, inner_.iso.month, inner_.iso.day);
    if (!r.ok()) {
      return diplomat::Err<TemporalError>(
          TemporalError::FromInfra(r.error()));
    }
    return diplomat::Ok<std::unique_ptr<PD>>(PD::FromInfra(r.value()));
  }

  // Stub: requires calendar-aware projection from MD + year.
  diplomat::result<int64_t, TemporalError> epoch_ms_for_with_provider(
      const Provider& /*p*/) const {
    return diplomat::Err<TemporalError>(TemporalError{
        ErrorKind::Range,
        "PlainMonthDay.epochMsFor requires a calendar backend"});
  }

  std::unique_ptr<PlainMonthDay> clone() const {
    return std::unique_ptr<PlainMonthDay>(new PlainMonthDay(inner_));
  }

  // ── Comparison ─────────────────────────────────────────────────

  bool equals(const PlainMonthDay& other) const {
    return inner_.iso.month == other.inner_.iso.month &&
           inner_.iso.day == other.inner_.iso.day;
  }

  static int8_t compare(const PlainMonthDay& one,
                         const PlainMonthDay& two) {
    if (one.inner_.iso.month != two.inner_.iso.month) {
      return one.inner_.iso.month < two.inner_.iso.month ? -1 : 1;
    }
    if (one.inner_.iso.day != two.inner_.iso.day) {
      return one.inner_.iso.day < two.inner_.iso.day ? -1 : 1;
    }
    return 0;
  }

  // ── Bridges ────────────────────────────────────────────────────

  const ::node::socketsecurity::temporal::PlainMonthDay& ToInfra() const {
    return inner_;
  }

  static std::unique_ptr<PlainMonthDay> FromInfra(
      const ::node::socketsecurity::temporal::PlainMonthDay& d) {
    return std::unique_ptr<PlainMonthDay>(new PlainMonthDay(d));
  }

  PlainMonthDay() = delete;
  PlainMonthDay(const PlainMonthDay&) = delete;
  PlainMonthDay(PlainMonthDay&&) noexcept = delete;
  PlainMonthDay& operator=(const PlainMonthDay&) = delete;
  PlainMonthDay& operator=(PlainMonthDay&&) noexcept = delete;

 private:
  explicit PlainMonthDay(
      ::node::socketsecurity::temporal::PlainMonthDay inner)
      : inner_(inner) {}

  ::node::socketsecurity::temporal::PlainMonthDay inner_;
};

}  // namespace temporal_rs

#endif  // TEMPORAL_RS_COMPAT_PLAINMONTHDAY_HPP_
