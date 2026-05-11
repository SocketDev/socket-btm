// Compat shim: temporal_rs::PlainYearMonth.

#ifndef TEMPORAL_RS_COMPAT_PLAINYEARMONTH_HPP_
#define TEMPORAL_RS_COMPAT_PLAINYEARMONTH_HPP_

#include <cstdint>
#include <memory>
#include <optional>
#include <string>
#include <string_view>

#include "socketsecurity/temporal/plain_date.h"
#include "socketsecurity/temporal/ixdtf_writer.h"
#include "socketsecurity/temporal/plain_year_month.h"
#include "temporal_rs/AnyCalendarKind.hpp"
#include "temporal_rs/ArithmeticOverflow.hpp"
#include "temporal_rs/Calendar.hpp"
#include "temporal_rs/DifferenceSettings.hpp"
#include "temporal_rs/DisplayCalendar.hpp"
#include "temporal_rs/Duration.hpp"
#include "temporal_rs/ParsedDate.hpp"
#include "temporal_rs/PartialDate.hpp"
#include "temporal_rs/PlainDate.hpp"
#include "temporal_rs/Provider.hpp"
#include "temporal_rs/TemporalError.hpp"
#include "temporal_rs/diplomat_runtime.hpp"

namespace temporal_rs {

class PlainDate;

class PlainYearMonth {
 public:
  static diplomat::result<std::unique_ptr<PlainYearMonth>, TemporalError>
  try_new_iso(int32_t year, uint8_t month,
                std::optional<uint8_t> reference_day) {
    auto result = ::node::socketsecurity::temporal::PlainYearMonthTryNewIso(
        year, month, reference_day);
    if (!result.ok()) {
      return diplomat::Err<TemporalError>(
          TemporalError::FromInfra(result.error()));
    }
    return diplomat::Ok<std::unique_ptr<PlainYearMonth>>(
        std::unique_ptr<PlainYearMonth>(new PlainYearMonth(result.value())));
  }

  static diplomat::result<std::unique_ptr<PlainYearMonth>, TemporalError>
  from_utf8(std::string_view s) {
    auto result = ::node::socketsecurity::temporal::PlainYearMonthFromUtf8(
        reinterpret_cast<const uint8_t*>(s.data()), s.size());
    if (!result.ok()) {
      return diplomat::Err<TemporalError>(
          TemporalError::FromInfra(result.error()));
    }
    return diplomat::Ok<std::unique_ptr<PlainYearMonth>>(
        std::unique_ptr<PlainYearMonth>(new PlainYearMonth(result.value())));
  }

  static diplomat::result<std::unique_ptr<PlainYearMonth>, TemporalError>
  from_partial(PartialDate /*partial*/,
               std::optional<ArithmeticOverflow> /*overflow*/) {
    // Stub: full PartialDate → PlainYearMonth resolution lands when
    // the calendar-aware path activates. Return Err so V8 surfaces a
    // RangeError rather than silently handing the caller a null
    // PlainYearMonth.
    return diplomat::Err<::temporal_rs::TemporalError>(::temporal_rs::TemporalError{::temporal_rs::ErrorKind::Range, "not yet implemented"});
  }

  static diplomat::result<std::unique_ptr<PlainYearMonth>, TemporalError>
  try_new_with_overflow(int32_t /*year*/, uint8_t /*month*/,
                        std::optional<uint8_t> /*reference_day*/,
                        AnyCalendarKind /*calendar*/,
                        ArithmeticOverflow /*overflow*/) {
    return diplomat::Err<::temporal_rs::TemporalError>(::temporal_rs::TemporalError{::temporal_rs::ErrorKind::Range, "not yet implemented"});
  }

  diplomat::result<std::unique_ptr<PlainYearMonth>, TemporalError>
  with(PartialDate /*partial*/,
       std::optional<ArithmeticOverflow> /*overflow*/) const {
    return diplomat::Ok<std::unique_ptr<PlainYearMonth>>(
        std::unique_ptr<PlainYearMonth>(new PlainYearMonth(inner_)));
  }

  diplomat::result<std::unique_ptr<PlainYearMonth>, TemporalError>
  add(const Duration& /*duration*/, ArithmeticOverflow /*overflow*/) const {
    return diplomat::Ok<std::unique_ptr<PlainYearMonth>>(
        std::unique_ptr<PlainYearMonth>(new PlainYearMonth(inner_)));
  }

  diplomat::result<std::unique_ptr<PlainYearMonth>, TemporalError>
  subtract(const Duration& /*duration*/,
           ArithmeticOverflow /*overflow*/) const {
    return diplomat::Ok<std::unique_ptr<PlainYearMonth>>(
        std::unique_ptr<PlainYearMonth>(new PlainYearMonth(inner_)));
  }

  diplomat::result<std::unique_ptr<Duration>, TemporalError>
  until(const PlainYearMonth& /*other*/,
        DifferenceSettings /*settings*/) const {
    return diplomat::Err<::temporal_rs::TemporalError>(::temporal_rs::TemporalError{::temporal_rs::ErrorKind::Range, "not yet implemented"});
  }

  diplomat::result<std::unique_ptr<Duration>, TemporalError>
  since(const PlainYearMonth& /*other*/,
        DifferenceSettings /*settings*/) const {
    return diplomat::Err<::temporal_rs::TemporalError>(::temporal_rs::TemporalError{::temporal_rs::ErrorKind::Range, "not yet implemented"});
  }

  diplomat::result<std::unique_ptr<PlainDate>, TemporalError>
  to_plain_date(std::optional<PartialDate> /*day*/) const {
    return diplomat::Err<::temporal_rs::TemporalError>(::temporal_rs::TemporalError{::temporal_rs::ErrorKind::Range, "not yet implemented"});
  }

  // Stub: requires calendar-aware day projection + provider integration.
  // Two-argument form (TimeZone + Provider) mirrors upstream Rust's
  // signature; the single-Provider overload below shares the same fate.
  diplomat::result<int64_t, TemporalError>
  epoch_ms_for_with_provider(TimeZone /*tz*/, const Provider& /*p*/) const {
    return diplomat::Err<TemporalError>(TemporalError{
        ErrorKind::Range,
        "PlainYearMonth.epochMsFor(timeZone, provider) requires a "
        "calendar backend + provider integration"});
  }

  // 1:1 from upstream plain_year_month.rs:630 / :638.
  std::string to_ixdtf_string(DisplayCalendar display_calendar) const {
    ::node::socketsecurity::temporal::FormattableYearMonth fym{
        ::node::socketsecurity::temporal::FormattableDate{
            inner_.iso.year, inner_.iso.month, inner_.iso.day},
        ::node::socketsecurity::temporal::FormattableCalendar{
            display_calendar.ToInfra(), "iso8601"}};
    return fym.ToString();
  }

  static diplomat::result<std::unique_ptr<PlainYearMonth>, TemporalError>
  from_utf16(std::u16string_view s) {
    std::string narrow;
    narrow.reserve(s.size());
    for (char16_t c : s) {
      if (c > 0x7F) {
        return diplomat::Err<TemporalError>(TemporalError{
            ErrorKind::Range,
            "Non-ASCII character in PlainYearMonth string"});
      }
      narrow.push_back(static_cast<char>(c));
    }
    return from_utf8(narrow);
  }

  // Build a PlainYearMonth from a parsed-and-validated record.
  static diplomat::result<std::unique_ptr<PlainYearMonth>, TemporalError>
  from_parsed(const ParsedDate& parsed) {
    auto r = ::node::socketsecurity::temporal::PlainYearMonthTryNewIso(
        parsed.year(), parsed.month(), std::optional<uint8_t>{});
    if (!r.ok()) {
      return diplomat::Err<TemporalError>(
          TemporalError::FromInfra(r.error()));
    }
    return diplomat::Ok<std::unique_ptr<PlainYearMonth>>(
        std::unique_ptr<PlainYearMonth>(new PlainYearMonth(r.value())));
  }

  int32_t year() const {
    return ::node::socketsecurity::temporal::PlainYearMonthYear(inner_);
  }
  uint8_t month() const {
    return ::node::socketsecurity::temporal::PlainYearMonthMonth(inner_);
  }
  uint8_t days_in_month() const {
    return ::node::socketsecurity::temporal::PlainYearMonthDaysInMonth(inner_);
  }
  bool in_leap_year() const {
    return ::node::socketsecurity::temporal::PlainYearMonthInLeapYear(inner_);
  }
  bool is_valid() const { return inner_.IsValid(); }

  // Calendar-aware accessors. ISO defaults until calendar.cc lands.
  Calendar calendar() const {
    return Calendar(::node::socketsecurity::temporal::Calendar::Iso());
  }
  uint16_t days_in_year() const {
    return ::node::socketsecurity::temporal::PlainDateDaysInYear(
        ::node::socketsecurity::temporal::PlainDate{inner_.iso});
  }
  uint8_t months_in_year() const { return 12; }
  std::string month_code() const { const uint8_t m = month(); return std::string("M") + (m < 10 ? "0" : "") + std::to_string(m); }
  std::string era() const { return ""; }
  std::optional<int32_t> era_year() const { return std::nullopt; }

  // Conversion: PlainYearMonth + day -> PlainDate.
  template <class PD>
  diplomat::result<std::unique_ptr<PD>, TemporalError> to_plain_date(
      const PD* /*reference_day_date*/) const {
    auto r = ::node::socketsecurity::temporal::PlainDateTryNewIso(
        inner_.iso.year, inner_.iso.month, inner_.iso.day);
    if (!r.ok()) {
      return diplomat::Err<TemporalError>(
          TemporalError::FromInfra(r.error()));
    }
    return diplomat::Ok<std::unique_ptr<PD>>(PD::FromInfra(r.value()));
  }

  // Stub: requires calendar-aware day projection.
  diplomat::result<int64_t, TemporalError> epoch_ms_for_with_provider(
      const Provider& /*p*/) const {
    return diplomat::Err<TemporalError>(TemporalError{
        ErrorKind::Range,
        "PlainYearMonth.epochMsFor requires a calendar backend"});
  }

  std::unique_ptr<PlainYearMonth> clone() const {
    return std::unique_ptr<PlainYearMonth>(new PlainYearMonth(inner_));
  }

  // ── Comparison ─────────────────────────────────────────────────

  bool equals(const PlainYearMonth& other) const {
    return inner_.iso.year == other.inner_.iso.year &&
           inner_.iso.month == other.inner_.iso.month;
  }

  static int8_t compare(const PlainYearMonth& one,
                         const PlainYearMonth& two) {
    if (one.inner_.iso.year != two.inner_.iso.year) {
      return one.inner_.iso.year < two.inner_.iso.year ? -1 : 1;
    }
    if (one.inner_.iso.month != two.inner_.iso.month) {
      return one.inner_.iso.month < two.inner_.iso.month ? -1 : 1;
    }
    return 0;
  }

  // ── Bridges ────────────────────────────────────────────────────

  const ::node::socketsecurity::temporal::PlainYearMonth& ToInfra() const {
    return inner_;
  }

  static std::unique_ptr<PlainYearMonth> FromInfra(
      const ::node::socketsecurity::temporal::PlainYearMonth& d) {
    return std::unique_ptr<PlainYearMonth>(new PlainYearMonth(d));
  }

  PlainYearMonth() = delete;
  PlainYearMonth(const PlainYearMonth&) = delete;
  PlainYearMonth(PlainYearMonth&&) noexcept = delete;
  PlainYearMonth& operator=(const PlainYearMonth&) = delete;
  PlainYearMonth& operator=(PlainYearMonth&&) noexcept = delete;

 private:
  explicit PlainYearMonth(
      ::node::socketsecurity::temporal::PlainYearMonth inner)
      : inner_(inner) {}

  ::node::socketsecurity::temporal::PlainYearMonth inner_;
};

}  // namespace temporal_rs

#endif  // TEMPORAL_RS_COMPAT_PLAINYEARMONTH_HPP_
