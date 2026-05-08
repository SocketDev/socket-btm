// Compat shim: temporal_rs::TimeZone. Upstream models this as a
// value-type struct with FFI-friendly fields (offset_minutes,
// resolved_id, ...); V8 declares `temporal_rs::TimeZone tz;` by
// value, copies it freely, and stores it in std::optional.
//
// We keep the same value semantics by holding a copyable instance
// of node::socketsecurity::temporal::TimeZone (which is itself
// default-constructible / copyable). Factories return `TimeZone`
// by value (not unique_ptr) to match upstream's surface.

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

class Provider;

struct TimeZone {
  ::node::socketsecurity::temporal::TimeZone inner;

  TimeZone() = default;
  TimeZone(const TimeZone&) = default;
  TimeZone(TimeZone&&) noexcept = default;
  TimeZone& operator=(const TimeZone&) = default;
  TimeZone& operator=(TimeZone&&) noexcept = default;

  static TimeZone utc() {
    TimeZone t;
    t.inner = ::node::socketsecurity::temporal::TimeZone::Utc();
    return t;
  }

  static TimeZone zero() { return utc(); }

  static diplomat::result<TimeZone, TemporalError> utc_with_provider(
      const Provider& /*p*/) {
    return diplomat::Ok<TimeZone>(utc());
  }

  static TimeZone from_offset_seconds(int64_t seconds) {
    TimeZone t;
    t.inner = ::node::socketsecurity::temporal::TimeZone::FromOffset(
        ::node::socketsecurity::temporal::UtcOffset::FromSeconds(seconds));
    return t;
  }

  static diplomat::result<TimeZone, TemporalError> try_from_identifier_str(
      std::string_view s) {
    auto r =
        ::node::socketsecurity::temporal::TimeZone::TryFromIdentifierStr(s);
    if (!r.ok()) {
      return diplomat::Err<TemporalError>(
          TemporalError::FromInfra(r.error()));
    }
    TimeZone t;
    t.inner = r.value();
    return diplomat::Ok<TimeZone>(std::move(t));
  }

  static diplomat::result<TimeZone, TemporalError>
  try_from_identifier_str_with_provider(std::string_view s,
                                         const Provider& /*p*/) {
    return try_from_identifier_str(s);
  }

  static diplomat::result<TimeZone, TemporalError> try_from_offset_str(
      std::string_view s) {
    return try_from_identifier_str(s);
  }

  static diplomat::result<TimeZone, TemporalError> try_from_str(
      std::string_view s) {
    return try_from_identifier_str(s);
  }

  static diplomat::result<TimeZone, TemporalError> try_from_str_with_provider(
      std::string_view s, const Provider& /*p*/) {
    return try_from_identifier_str(s);
  }

  std::string identifier() const { return inner.Identifier(); }

  diplomat::result<std::string, TemporalError> identifier_with_provider(
      const Provider& /*p*/) const {
    return diplomat::Ok<std::string>(inner.Identifier());
  }

  bool is_offset() const { return inner.IsOffsetOnly(); }

  diplomat::result<TimeZone, TemporalError> primary_identifier() const {
    return diplomat::Ok<TimeZone>(*this);
  }

  diplomat::result<TimeZone, TemporalError> primary_identifier_with_provider(
      const Provider& /*p*/) const {
    return diplomat::Ok<TimeZone>(*this);
  }

  // ── Bridges ────────────────────────────────────────────────────

  const ::node::socketsecurity::temporal::TimeZone& ToInfra() const {
    return inner;
  }

  static TimeZone FromInfra(
      const ::node::socketsecurity::temporal::TimeZone& tz) {
    TimeZone t;
    t.inner = tz;
    return t;
  }
};

}  // namespace temporal_rs

#endif  // TEMPORAL_RS_COMPAT_TIMEZONE_HPP_
