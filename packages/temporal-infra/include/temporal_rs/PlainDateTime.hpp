// Compat shim: temporal_rs::PlainDateTime. Heap-owned wrapper.

#ifndef TEMPORAL_RS_COMPAT_PLAINDATETIME_HPP_
#define TEMPORAL_RS_COMPAT_PLAINDATETIME_HPP_

#include <cstdint>
#include <memory>
#include <optional>
#include <string>
#include <string_view>

#include "socketsecurity/temporal/plain_date_time.h"
#include "temporal_rs/AnyCalendarKind.hpp"
#include "temporal_rs/ArithmeticOverflow.hpp"
#include "temporal_rs/PartialDateTime.hpp"
#include "temporal_rs/TemporalError.hpp"
#include "temporal_rs/diplomat_runtime.hpp"

namespace temporal_rs {

class PlainDateTime {
 public:
  static diplomat::result<std::unique_ptr<PlainDateTime>, TemporalError>
  try_new(int32_t year, uint8_t month, uint8_t day, uint8_t hour,
           uint8_t minute, uint8_t second, uint16_t millisecond,
           uint16_t microsecond, uint16_t nanosecond,
           AnyCalendarKind /*calendar*/) {
    auto result = ::node::socketsecurity::temporal::PlainDateTimeTryNew(
        year, month, day, hour, minute, second, millisecond, microsecond,
        nanosecond);
    if (!result.ok()) {
      return diplomat::Err<TemporalError>(
          TemporalError::FromInfra(result.error()));
    }
    return diplomat::Ok<std::unique_ptr<PlainDateTime>>(
        std::unique_ptr<PlainDateTime>(new PlainDateTime(result.value())));
  }

  static diplomat::result<std::unique_ptr<PlainDateTime>, TemporalError>
  try_new_with_overflow(int32_t year, uint8_t month, uint8_t day,
                         uint8_t hour, uint8_t minute, uint8_t second,
                         uint16_t millisecond, uint16_t microsecond,
                         uint16_t nanosecond, AnyCalendarKind /*calendar*/,
                         ArithmeticOverflow overflow) {
    auto result =
        ::node::socketsecurity::temporal::PlainDateTimeNewWithOverflow(
            year, month, day, hour, minute, second, millisecond, microsecond,
            nanosecond, overflow.ToInfra());
    if (!result.ok()) {
      return diplomat::Err<TemporalError>(
          TemporalError::FromInfra(result.error()));
    }
    return diplomat::Ok<std::unique_ptr<PlainDateTime>>(
        std::unique_ptr<PlainDateTime>(new PlainDateTime(result.value())));
  }

  static diplomat::result<std::unique_ptr<PlainDateTime>, TemporalError>
  from_partial(PartialDateTime partial,
                std::optional<ArithmeticOverflow> overflow) {
    std::optional<::node::socketsecurity::temporal::Overflow> infra_overflow;
    if (overflow.has_value()) {
      infra_overflow = overflow->ToInfra();
    }
    auto result = ::node::socketsecurity::temporal::PlainDateTimeFromPartial(
        partial.ToInfra(), infra_overflow);
    if (!result.ok()) {
      return diplomat::Err<TemporalError>(
          TemporalError::FromInfra(result.error()));
    }
    return diplomat::Ok<std::unique_ptr<PlainDateTime>>(
        std::unique_ptr<PlainDateTime>(new PlainDateTime(result.value())));
  }

  static diplomat::result<std::unique_ptr<PlainDateTime>, TemporalError>
  from_utf8(std::string_view s) {
    auto result = ::node::socketsecurity::temporal::PlainDateTimeFromUtf8(
        reinterpret_cast<const uint8_t*>(s.data()), s.size());
    if (!result.ok()) {
      return diplomat::Err<TemporalError>(
          TemporalError::FromInfra(result.error()));
    }
    return diplomat::Ok<std::unique_ptr<PlainDateTime>>(
        std::unique_ptr<PlainDateTime>(new PlainDateTime(result.value())));
  }

  static diplomat::result<std::unique_ptr<PlainDateTime>, TemporalError>
  from_utf16(std::u16string_view s) {
    std::string narrow;
    narrow.reserve(s.size());
    for (char16_t c : s) {
      if (c > 0x7F) {
        return diplomat::Err<TemporalError>(TemporalError{
            ErrorKind::Range,
            "Non-ASCII character in PlainDateTime string"});
      }
      narrow.push_back(static_cast<char>(c));
    }
    return from_utf8(narrow);
  }

  // Field accessors.
  int32_t year() const {
    return ::node::socketsecurity::temporal::PlainDateTimeYear(inner_);
  }
  uint8_t month() const {
    return ::node::socketsecurity::temporal::PlainDateTimeMonth(inner_);
  }
  uint8_t day() const {
    return ::node::socketsecurity::temporal::PlainDateTimeDay(inner_);
  }
  uint8_t hour() const {
    return ::node::socketsecurity::temporal::PlainDateTimeHour(inner_);
  }
  uint8_t minute() const {
    return ::node::socketsecurity::temporal::PlainDateTimeMinute(inner_);
  }
  uint8_t second() const {
    return ::node::socketsecurity::temporal::PlainDateTimeSecond(inner_);
  }
  uint16_t millisecond() const {
    return ::node::socketsecurity::temporal::PlainDateTimeMillisecond(inner_);
  }
  uint16_t microsecond() const {
    return ::node::socketsecurity::temporal::PlainDateTimeMicrosecond(inner_);
  }
  uint16_t nanosecond() const {
    return ::node::socketsecurity::temporal::PlainDateTimeNanosecond(inner_);
  }
  bool is_valid() const { return inner_.IsValid(); }

  std::unique_ptr<PlainDateTime> clone() const {
    return std::unique_ptr<PlainDateTime>(new PlainDateTime(inner_));
  }

  // ── Arithmetic ─────────────────────────────────────────────────

  template <class D>
  diplomat::result<std::unique_ptr<PlainDateTime>, TemporalError> add(
      const D& duration,
      std::optional<ArithmeticOverflow> overflow) const {
    std::optional<::node::socketsecurity::temporal::Overflow> infra_overflow;
    if (overflow.has_value()) {
      infra_overflow = overflow->ToInfra();
    }
    auto r = ::node::socketsecurity::temporal::PlainDateTimeAdd(
        inner_, duration.ToInfra(), infra_overflow);
    if (!r.ok()) {
      return diplomat::Err<TemporalError>(
          TemporalError::FromInfra(r.error()));
    }
    return diplomat::Ok<std::unique_ptr<PlainDateTime>>(
        std::unique_ptr<PlainDateTime>(new PlainDateTime(r.value())));
  }

  template <class D>
  diplomat::result<std::unique_ptr<PlainDateTime>, TemporalError> subtract(
      const D& duration,
      std::optional<ArithmeticOverflow> overflow) const {
    std::optional<::node::socketsecurity::temporal::Overflow> infra_overflow;
    if (overflow.has_value()) {
      infra_overflow = overflow->ToInfra();
    }
    auto r = ::node::socketsecurity::temporal::PlainDateTimeSubtract(
        inner_, duration.ToInfra(), infra_overflow);
    if (!r.ok()) {
      return diplomat::Err<TemporalError>(
          TemporalError::FromInfra(r.error()));
    }
    return diplomat::Ok<std::unique_ptr<PlainDateTime>>(
        std::unique_ptr<PlainDateTime>(new PlainDateTime(r.value())));
  }

  template <class D, class S>
  diplomat::result<std::unique_ptr<D>, TemporalError> since(
      const PlainDateTime& other, S /*settings*/) const {
    auto r = ::node::socketsecurity::temporal::PlainDateTimeSince(
        inner_, other.inner_);
    if (!r.ok()) {
      return diplomat::Err<TemporalError>(
          TemporalError::FromInfra(r.error()));
    }
    return diplomat::Ok<std::unique_ptr<D>>(D::FromInfra(r.value()));
  }

  template <class D, class S>
  diplomat::result<std::unique_ptr<D>, TemporalError> until(
      const PlainDateTime& other, S /*settings*/) const {
    auto r = ::node::socketsecurity::temporal::PlainDateTimeUntil(
        inner_, other.inner_);
    if (!r.ok()) {
      return diplomat::Err<TemporalError>(
          TemporalError::FromInfra(r.error()));
    }
    return diplomat::Ok<std::unique_ptr<D>>(D::FromInfra(r.value()));
  }

  // ── Conversions ────────────────────────────────────────────────

  template <class PD>
  std::unique_ptr<PD> to_plain_date() const {
    auto d =
        ::node::socketsecurity::temporal::PlainDateTimeToPlainDate(inner_);
    return PD::FromInfra(d);
  }

  template <class PT>
  std::unique_ptr<PT> to_plain_time() const {
    auto d =
        ::node::socketsecurity::temporal::PlainDateTimeToPlainTime(inner_);
    return PT::FromInfra(d);
  }

  // ── Bridges ────────────────────────────────────────────────────

  const ::node::socketsecurity::temporal::PlainDateTime& ToInfra() const {
    return inner_;
  }

  static std::unique_ptr<PlainDateTime> FromInfra(
      const ::node::socketsecurity::temporal::PlainDateTime& d) {
    return std::unique_ptr<PlainDateTime>(new PlainDateTime(d));
  }

  PlainDateTime() = delete;
  PlainDateTime(const PlainDateTime&) = delete;
  PlainDateTime(PlainDateTime&&) noexcept = delete;
  PlainDateTime& operator=(const PlainDateTime&) = delete;
  PlainDateTime& operator=(PlainDateTime&&) noexcept = delete;

 private:
  explicit PlainDateTime(::node::socketsecurity::temporal::PlainDateTime inner)
      : inner_(inner) {}

  ::node::socketsecurity::temporal::PlainDateTime inner_;
};

}  // namespace temporal_rs

#endif  // TEMPORAL_RS_COMPAT_PLAINDATETIME_HPP_
