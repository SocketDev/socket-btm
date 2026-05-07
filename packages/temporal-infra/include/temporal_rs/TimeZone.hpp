// Compat shim: temporal_rs::TimeZone — heap-owned wrapper. Diplomat
// conventions: non-copyable / non-movable.

#ifndef TEMPORAL_RS_COMPAT_TIMEZONE_HPP_
#define TEMPORAL_RS_COMPAT_TIMEZONE_HPP_

#include <cstdint>
#include <memory>
#include <string>
#include <string_view>

#include "socketsecurity/temporal/error.h"
#include "socketsecurity/temporal/time_zone.h"
#include "temporal_rs/TemporalError.hpp"
#include "temporal_rs/diplomat_runtime.hpp"

namespace temporal_rs {

class TimeZone {
 public:
  static std::unique_ptr<TimeZone> utc() {
    return std::unique_ptr<TimeZone>(new TimeZone(
        ::node::socketsecurity::temporal::TimeZone::Utc()));
  }

  static std::unique_ptr<TimeZone> from_offset_seconds(int64_t seconds) {
    return std::unique_ptr<TimeZone>(new TimeZone(
        ::node::socketsecurity::temporal::TimeZone::FromOffset(
            ::node::socketsecurity::temporal::UtcOffset::FromSeconds(seconds))));
  }

  static diplomat::result<std::unique_ptr<TimeZone>, TemporalError>
  try_from_identifier_str(std::string_view s) {
    auto r =
        ::node::socketsecurity::temporal::TimeZone::TryFromIdentifierStr(s);
    if (!r.ok()) {
      return diplomat::Err<TemporalError>(
          TemporalError::FromInfra(r.error()));
    }
    return diplomat::Ok<std::unique_ptr<TimeZone>>(
        std::unique_ptr<TimeZone>(new TimeZone(r.value())));
  }

  static diplomat::result<std::unique_ptr<TimeZone>, TemporalError>
  try_from_str(std::string_view s) {
    return try_from_identifier_str(s);
  }

  std::string identifier() const { return inner_.Identifier(); }

  bool is_offset() const { return inner_.IsOffsetOnly(); }

  std::unique_ptr<TimeZone> clone() const {
    return std::unique_ptr<TimeZone>(new TimeZone(inner_));
  }

  const ::node::socketsecurity::temporal::TimeZone& ToInfra() const {
    return inner_;
  }

  static std::unique_ptr<TimeZone> FromInfra(
      const ::node::socketsecurity::temporal::TimeZone& tz) {
    return std::unique_ptr<TimeZone>(new TimeZone(tz));
  }

  TimeZone() = delete;
  TimeZone(const TimeZone&) = delete;
  TimeZone(TimeZone&&) noexcept = delete;
  TimeZone& operator=(const TimeZone&) = delete;
  TimeZone& operator=(TimeZone&&) noexcept = delete;

 private:
  explicit TimeZone(::node::socketsecurity::temporal::TimeZone inner)
      : inner_(inner) {}

  ::node::socketsecurity::temporal::TimeZone inner_;
};

}  // namespace temporal_rs

#endif  // TEMPORAL_RS_COMPAT_TIMEZONE_HPP_
