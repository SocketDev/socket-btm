// Compat shim: temporal_rs::ZonedDateTime — heap-owned wrapper around
// node::socketsecurity::temporal::ZonedDateTime. Diplomat conventions:
// non-copyable / non-movable, factories return result<unique_ptr,...>.

#ifndef TEMPORAL_RS_COMPAT_ZONEDDATETIME_HPP_
#define TEMPORAL_RS_COMPAT_ZONEDDATETIME_HPP_

#include <cstdint>
#include <memory>
#include <optional>
#include <string>
#include <string_view>

#include "socketsecurity/temporal/error.h"
#include "socketsecurity/temporal/temporal.h"
#include "socketsecurity/temporal/zoned_date_time.h"
#include "temporal_rs/Calendar.hpp"
#include "temporal_rs/Instant.hpp"
#include "temporal_rs/PlainDate.hpp"
#include "temporal_rs/PlainDateTime.hpp"
#include "temporal_rs/PlainTime.hpp"
#include "temporal_rs/TemporalError.hpp"
#include "temporal_rs/TimeZone.hpp"
#include "temporal_rs/diplomat_runtime.hpp"

namespace temporal_rs {

class Duration;
struct DifferenceSettings;
struct RoundingOptions;
struct ToStringRoundingOptions;
struct PartialZonedDateTime;

class ZonedDateTime {
 public:
  static diplomat::result<std::unique_ptr<ZonedDateTime>, TemporalError>
  try_new(const Instant& instant, const TimeZone& tz, const Calendar& cal) {
    auto r = ::node::socketsecurity::temporal::ZonedDateTimeTryNew(
        ::node::socketsecurity::temporal::Instant{instant.ToInfra()},
        tz.ToInfra(), cal.ToInfra());
    if (!r.ok()) {
      return diplomat::Err<TemporalError>(
          TemporalError::FromInfra(r.error()));
    }
    return diplomat::Ok<std::unique_ptr<ZonedDateTime>>(
        std::unique_ptr<ZonedDateTime>(new ZonedDateTime(std::move(r.value()))));
  }

  static diplomat::result<std::unique_ptr<ZonedDateTime>, TemporalError>
  from_utf8(std::string_view s) {
    auto r = ::node::socketsecurity::temporal::ZonedDateTimeFromUtf8(
        reinterpret_cast<const uint8_t*>(s.data()), s.size());
    if (!r.ok()) {
      return diplomat::Err<TemporalError>(
          TemporalError::FromInfra(r.error()));
    }
    return diplomat::Ok<std::unique_ptr<ZonedDateTime>>(
        std::unique_ptr<ZonedDateTime>(new ZonedDateTime(std::move(r.value()))));
  }

  static diplomat::result<std::unique_ptr<ZonedDateTime>, TemporalError>
  from_utf16(std::u16string_view s) {
    std::string narrow;
    narrow.reserve(s.size());
    for (char16_t c : s) {
      if (c > 0x7F) {
        return diplomat::Err<TemporalError>(TemporalError{
            ErrorKind::Range, "Non-ASCII character in ZonedDateTime string"});
      }
      narrow.push_back(static_cast<char>(c));
    }
    return from_utf8(narrow);
  }

  // ── Field accessors ─────────────────────────────────────────────

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
  uint16_t millisecond() const {
    return ::node::socketsecurity::temporal::ZonedDateTimeMillisecond(inner_);
  }
  uint16_t microsecond() const {
    return ::node::socketsecurity::temporal::ZonedDateTimeMicrosecond(inner_);
  }
  uint16_t nanosecond() const {
    return ::node::socketsecurity::temporal::ZonedDateTimeNanosecond(inner_);
  }

  std::unique_ptr<Calendar> get_calendar() const {
    return Calendar::FromInfra(inner_.calendar);
  }

  std::unique_ptr<TimeZone> get_time_zone() const {
    return TimeZone::FromInfra(inner_.time_zone);
  }

  // ── Conversions ─────────────────────────────────────────────────

  std::unique_ptr<Instant> to_instant() const {
    return Instant::FromInfra(
        ::node::socketsecurity::temporal::ZonedDateTimeToInstant(inner_));
  }

  diplomat::result<std::unique_ptr<PlainDateTime>, TemporalError>
  to_plain_date_time() const {
    auto r = ::node::socketsecurity::temporal::ZonedDateTimeToPlainDateTime(
        inner_);
    if (!r.ok()) {
      return diplomat::Err<TemporalError>(
          TemporalError::FromInfra(r.error()));
    }
    return diplomat::Ok<std::unique_ptr<PlainDateTime>>(
        PlainDateTime::FromInfra(r.value()));
  }

  diplomat::result<std::unique_ptr<PlainDate>, TemporalError>
  to_plain_date() const {
    auto r =
        ::node::socketsecurity::temporal::ZonedDateTimeToPlainDate(inner_);
    if (!r.ok()) {
      return diplomat::Err<TemporalError>(
          TemporalError::FromInfra(r.error()));
    }
    return diplomat::Ok<std::unique_ptr<PlainDate>>(
        PlainDate::FromInfra(r.value()));
  }

  diplomat::result<std::unique_ptr<PlainTime>, TemporalError>
  to_plain_time() const {
    auto r =
        ::node::socketsecurity::temporal::ZonedDateTimeToPlainTime(inner_);
    if (!r.ok()) {
      return diplomat::Err<TemporalError>(
          TemporalError::FromInfra(r.error()));
    }
    return diplomat::Ok<std::unique_ptr<PlainTime>>(
        PlainTime::FromInfra(r.value()));
  }

  // ── Comparison ─────────────────────────────────────────────────

  int8_t compare_instant(const ZonedDateTime& other) const {
    if (inner_.instant.epoch_nanoseconds <
        other.inner_.instant.epoch_nanoseconds) {
      return -1;
    }
    if (inner_.instant.epoch_nanoseconds >
        other.inner_.instant.epoch_nanoseconds) {
      return 1;
    }
    return 0;
  }

  bool equals(const ZonedDateTime& other) const {
    return inner_.instant.epoch_nanoseconds ==
               other.inner_.instant.epoch_nanoseconds &&
           inner_.calendar == other.inner_.calendar;
  }

  // ── Clone ──────────────────────────────────────────────────────

  std::unique_ptr<ZonedDateTime> clone() const {
    return std::unique_ptr<ZonedDateTime>(new ZonedDateTime(inner_));
  }

  // ── Bridges ────────────────────────────────────────────────────

  const ::node::socketsecurity::temporal::ZonedDateTime& ToInfra() const {
    return inner_;
  }

  static std::unique_ptr<ZonedDateTime> FromInfra(
      const ::node::socketsecurity::temporal::ZonedDateTime& zdt) {
    return std::unique_ptr<ZonedDateTime>(new ZonedDateTime(zdt));
  }

  ZonedDateTime() = delete;
  ZonedDateTime(const ZonedDateTime&) = delete;
  ZonedDateTime(ZonedDateTime&&) noexcept = delete;
  ZonedDateTime& operator=(const ZonedDateTime&) = delete;
  ZonedDateTime& operator=(ZonedDateTime&&) noexcept = delete;

 private:
  explicit ZonedDateTime(::node::socketsecurity::temporal::ZonedDateTime inner)
      : inner_(inner) {}

  ::node::socketsecurity::temporal::ZonedDateTime inner_;
};

}  // namespace temporal_rs

#endif  // TEMPORAL_RS_COMPAT_ZONEDDATETIME_HPP_
