// Compat shim: temporal_rs::ParsedDateTime.

#ifndef TEMPORAL_RS_COMPAT_PARSEDDATETIME_HPP_
#define TEMPORAL_RS_COMPAT_PARSEDDATETIME_HPP_

#include <cstdint>
#include <memory>
#include <string_view>

#include "socketsecurity/temporal/parsed_intermediates.h"
#include "temporal_rs/AnyCalendarKind.hpp"
#include "temporal_rs/ParsedDate.hpp"
#include "temporal_rs/TemporalError.hpp"
#include "temporal_rs/diplomat_runtime.hpp"

namespace temporal_rs {

class ParsedDateTime {
 public:
  static diplomat::result<std::unique_ptr<ParsedDateTime>, TemporalError>
  from_utf8(std::string_view s) {
    auto r = ::node::socketsecurity::temporal::ParsedDateTime::FromUtf8(
        reinterpret_cast<const uint8_t*>(s.data()), s.size());
    if (!r.ok()) {
      return diplomat::Err<TemporalError>(
          TemporalError::FromInfra(r.error()));
    }
    return diplomat::Ok<std::unique_ptr<ParsedDateTime>>(
        std::unique_ptr<ParsedDateTime>(new ParsedDateTime(r.value())));
  }

  static diplomat::result<std::unique_ptr<ParsedDateTime>, TemporalError>
  from_utf16(std::u16string_view s) {
    std::string narrow;
    narrow.reserve(s.size());
    for (char16_t c : s) {
      if (c > 0x7F) {
        return diplomat::Err<TemporalError>(TemporalError{
            ErrorKind::Range,
            "Non-ASCII character in ParsedDateTime string"});
      }
      narrow.push_back(static_cast<char>(c));
    }
    return from_utf8(narrow);
  }

  int32_t year() const { return inner_.date.record.year; }
  uint8_t month() const { return inner_.date.record.month; }
  uint8_t day() const { return inner_.date.record.day; }
  uint8_t hour() const { return inner_.time.hour; }
  uint8_t minute() const { return inner_.time.minute; }
  uint8_t second() const { return inner_.time.second; }
  uint16_t millisecond() const { return inner_.time.millisecond; }
  uint16_t microsecond() const { return inner_.time.microsecond; }
  uint16_t nanosecond() const { return inner_.time.nanosecond; }

  AnyCalendarKind calendar() const {
    return AnyCalendarKind::FromInfra(
        static_cast<::node::socketsecurity::temporal::CalendarKind>(
            inner_.date.calendar_kind));
  }

  const ::node::socketsecurity::temporal::ParsedDateTime& ToInfra() const {
    return inner_;
  }

  ParsedDateTime() = delete;
  ParsedDateTime(const ParsedDateTime&) = delete;
  ParsedDateTime(ParsedDateTime&&) noexcept = delete;
  ParsedDateTime& operator=(const ParsedDateTime&) = delete;
  ParsedDateTime& operator=(ParsedDateTime&&) noexcept = delete;

 private:
  explicit ParsedDateTime(
      ::node::socketsecurity::temporal::ParsedDateTime inner)
      : inner_(inner) {}

  ::node::socketsecurity::temporal::ParsedDateTime inner_;
};

}  // namespace temporal_rs

#endif  // TEMPORAL_RS_COMPAT_PARSEDDATETIME_HPP_
