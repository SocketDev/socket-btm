// Compat shim: temporal_rs::ParsedZonedDateTime. The temporal-infra
// port routes ZDT parsing through ZonedDateTimeFromUtf8 directly
// (returning a fully-resolved ZonedDateTime), so this shim is a thin
// adapter that defers to ZonedDateTime::from_utf8.

#ifndef TEMPORAL_RS_COMPAT_PARSEDZONEDDATETIME_HPP_
#define TEMPORAL_RS_COMPAT_PARSEDZONEDDATETIME_HPP_

#include <cstdint>
#include <memory>
#include <string_view>

#include "socketsecurity/temporal/zoned_date_time.h"
#include "temporal_rs/Disambiguation.hpp"
#include "temporal_rs/OffsetDisambiguation.hpp"
#include "temporal_rs/Provider.hpp"
#include "temporal_rs/TemporalError.hpp"
#include "temporal_rs/ZonedDateTime.hpp"
#include "temporal_rs/diplomat_runtime.hpp"

namespace temporal_rs {

class ParsedZonedDateTime {
 public:
  static diplomat::result<std::unique_ptr<ParsedZonedDateTime>, TemporalError>
  from_utf8(std::string_view s) {
    auto r = ::node::socketsecurity::temporal::ZonedDateTimeFromUtf8(
        reinterpret_cast<const uint8_t*>(s.data()), s.size());
    if (!r.ok()) {
      return diplomat::Err<TemporalError>(
          TemporalError::FromInfra(r.error()));
    }
    return diplomat::Ok<std::unique_ptr<ParsedZonedDateTime>>(
        std::unique_ptr<ParsedZonedDateTime>(
            new ParsedZonedDateTime(r.value())));
  }

  std::unique_ptr<ZonedDateTime> to_zoned_date_time() const {
    return ZonedDateTime::FromInfra(inner_);
  }

  // _with_provider variant - V8 calls this from within IXDTF parse
  // helpers. Routes to from_utf8 (the Provider arg is a marker since
  // the C++ port resolves IANA via TimeZoneBackend internally).
  static diplomat::result<std::unique_ptr<ParsedZonedDateTime>, TemporalError>
  from_utf8_with_provider(std::string_view s, const Provider& /*p*/) {
    return from_utf8(s);
  }

  static diplomat::result<std::unique_ptr<ParsedZonedDateTime>, TemporalError>
  from_utf16_with_provider(std::u16string_view s, const Provider& /*p*/) {
    std::string narrow;
    narrow.reserve(s.size());
    for (char16_t c : s) {
      if (c > 0x7F) {
        return diplomat::Err<TemporalError>(TemporalError{
            ErrorKind::Range,
            "Non-ASCII character in ParsedZonedDateTime string"});
      }
      narrow.push_back(static_cast<char>(c));
    }
    return from_utf8(narrow);
  }

  int32_t year() const {
    return ::node::socketsecurity::temporal::ZonedDateTimeYear(inner_);
  }
  uint8_t month() const {
    return ::node::socketsecurity::temporal::ZonedDateTimeMonth(inner_);
  }
  uint8_t day() const {
    return ::node::socketsecurity::temporal::ZonedDateTimeDay(inner_);
  }
  uint8_t hour() const {
    return ::node::socketsecurity::temporal::ZonedDateTimeHour(inner_);
  }
  uint8_t minute() const {
    return ::node::socketsecurity::temporal::ZonedDateTimeMinute(inner_);
  }
  uint8_t second() const {
    return ::node::socketsecurity::temporal::ZonedDateTimeSecond(inner_);
  }

  ParsedZonedDateTime() = delete;
  ParsedZonedDateTime(const ParsedZonedDateTime&) = delete;
  ParsedZonedDateTime(ParsedZonedDateTime&&) noexcept = delete;
  ParsedZonedDateTime& operator=(const ParsedZonedDateTime&) = delete;
  ParsedZonedDateTime& operator=(ParsedZonedDateTime&&) noexcept = delete;

 private:
  explicit ParsedZonedDateTime(
      ::node::socketsecurity::temporal::ZonedDateTime inner)
      : inner_(inner) {}

  ::node::socketsecurity::temporal::ZonedDateTime inner_;
};

// ── ZonedDateTime::from_parsed{,_with_provider} definitions ──────
//
// Declared in ZonedDateTime.hpp; defined here where ParsedZonedDateTime
// is fully visible. V8's call sites pull both headers transitively
// before instantiating these.

inline diplomat::result<std::unique_ptr<ZonedDateTime>, TemporalError>
ZonedDateTime::from_parsed(const ParsedZonedDateTime& parsed,
                            Disambiguation /*disambiguation*/,
                            OffsetDisambiguation /*offset_option*/) {
  return diplomat::Ok<std::unique_ptr<ZonedDateTime>>(
      parsed.to_zoned_date_time());
}

inline diplomat::result<std::unique_ptr<ZonedDateTime>, TemporalError>
ZonedDateTime::from_parsed_with_provider(const ParsedZonedDateTime& parsed,
                                          Disambiguation disambiguation,
                                          OffsetDisambiguation offset_option,
                                          const Provider& /*p*/) {
  return from_parsed(parsed, disambiguation, offset_option);
}

}  // namespace temporal_rs

#endif  // TEMPORAL_RS_COMPAT_PARSEDZONEDDATETIME_HPP_
