// Compat shim: temporal_rs::ParsedDate.

#ifndef TEMPORAL_RS_COMPAT_PARSEDDATE_HPP_
#define TEMPORAL_RS_COMPAT_PARSEDDATE_HPP_

#include <cstdint>
#include <memory>
#include <string>
#include <string_view>

#include "socketsecurity/temporal/parsed_intermediates.h"
#include "temporal_rs/AnyCalendarKind.hpp"
#include "temporal_rs/TemporalError.hpp"
#include "temporal_rs/diplomat_runtime.hpp"

namespace temporal_rs {

class ParsedDate {
 public:
  static diplomat::result<std::unique_ptr<ParsedDate>, TemporalError>
  from_utf8(std::string_view s) {
    auto r = ::node::socketsecurity::temporal::ParsedDate::FromUtf8(
        reinterpret_cast<const uint8_t*>(s.data()), s.size());
    if (!r.ok()) {
      return diplomat::Err<TemporalError>(
          TemporalError::FromInfra(r.error()));
    }
    return diplomat::Ok<std::unique_ptr<ParsedDate>>(
        std::unique_ptr<ParsedDate>(new ParsedDate(r.value())));
  }

  static diplomat::result<std::unique_ptr<ParsedDate>, TemporalError>
  year_month_from_utf8(std::string_view s) {
    auto r = ::node::socketsecurity::temporal::ParsedDate::YearMonthFromUtf8(
        reinterpret_cast<const uint8_t*>(s.data()), s.size());
    if (!r.ok()) {
      return diplomat::Err<TemporalError>(
          TemporalError::FromInfra(r.error()));
    }
    return diplomat::Ok<std::unique_ptr<ParsedDate>>(
        std::unique_ptr<ParsedDate>(new ParsedDate(r.value())));
  }

  static diplomat::result<std::unique_ptr<ParsedDate>, TemporalError>
  month_day_from_utf8(std::string_view s) {
    auto r = ::node::socketsecurity::temporal::ParsedDate::MonthDayFromUtf8(
        reinterpret_cast<const uint8_t*>(s.data()), s.size());
    if (!r.ok()) {
      return diplomat::Err<TemporalError>(
          TemporalError::FromInfra(r.error()));
    }
    return diplomat::Ok<std::unique_ptr<ParsedDate>>(
        std::unique_ptr<ParsedDate>(new ParsedDate(r.value())));
  }

 private:
  // Helper: transcode UTF-16 to ASCII (Temporal IXDTF strings are
  // always ASCII; non-ASCII triggers a parse error). Used by the
  // utf16 variants below.
  static std::optional<std::string> AsciiNarrow(std::u16string_view s) {
    std::string narrow;
    narrow.reserve(s.size());
    for (char16_t c : s) {
      if (c > 0x7F) {
        return std::nullopt;
      }
      narrow.push_back(static_cast<char>(c));
    }
    return narrow;
  }

 public:
  static diplomat::result<std::unique_ptr<ParsedDate>, TemporalError>
  from_utf16(std::u16string_view s) {
    auto narrow = AsciiNarrow(s);
    if (!narrow.has_value()) {
      return diplomat::Err<TemporalError>(TemporalError{
          ErrorKind::Range, "Non-ASCII character in ParsedDate string"});
    }
    return from_utf8(*narrow);
  }

  static diplomat::result<std::unique_ptr<ParsedDate>, TemporalError>
  year_month_from_utf16(std::u16string_view s) {
    auto narrow = AsciiNarrow(s);
    if (!narrow.has_value()) {
      return diplomat::Err<TemporalError>(TemporalError{
          ErrorKind::Range, "Non-ASCII character in ParsedDate string"});
    }
    return year_month_from_utf8(*narrow);
  }

  static diplomat::result<std::unique_ptr<ParsedDate>, TemporalError>
  month_day_from_utf16(std::u16string_view s) {
    auto narrow = AsciiNarrow(s);
    if (!narrow.has_value()) {
      return diplomat::Err<TemporalError>(TemporalError{
          ErrorKind::Range, "Non-ASCII character in ParsedDate string"});
    }
    return month_day_from_utf8(*narrow);
  }

  int32_t year() const { return inner_.record.year; }
  uint8_t month() const { return inner_.record.month; }
  uint8_t day() const { return inner_.record.day; }

  AnyCalendarKind calendar() const {
    return AnyCalendarKind::FromInfra(
        static_cast<::node::socketsecurity::temporal::CalendarKind>(
            inner_.calendar_kind));
  }

  const ::node::socketsecurity::temporal::ParsedDate& ToInfra() const {
    return inner_;
  }

  ParsedDate() = delete;
  ParsedDate(const ParsedDate&) = delete;
  ParsedDate(ParsedDate&&) noexcept = delete;
  ParsedDate& operator=(const ParsedDate&) = delete;
  ParsedDate& operator=(ParsedDate&&) noexcept = delete;

 private:
  explicit ParsedDate(::node::socketsecurity::temporal::ParsedDate inner)
      : inner_(inner) {}

  ::node::socketsecurity::temporal::ParsedDate inner_;
};

}  // namespace temporal_rs

#endif  // TEMPORAL_RS_COMPAT_PARSEDDATE_HPP_
