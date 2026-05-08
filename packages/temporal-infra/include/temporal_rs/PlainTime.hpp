// Compat shim: temporal_rs::PlainTime. Heap-owned wrapper.

#ifndef TEMPORAL_RS_COMPAT_PLAINTIME_HPP_
#define TEMPORAL_RS_COMPAT_PLAINTIME_HPP_

#include <cstdint>
#include <memory>
#include <optional>
#include <string>
#include <string_view>

#include "socketsecurity/temporal/plain_time.h"
#include "temporal_rs/ArithmeticOverflow.hpp"
#include "temporal_rs/DifferenceSettings.hpp"
#include "temporal_rs/Duration.hpp"
#include "temporal_rs/I128Nanoseconds.hpp"
#include "temporal_rs/PartialTime.hpp"
#include "temporal_rs/Provider.hpp"
#include "temporal_rs/RoundingOptions.hpp"
#include "temporal_rs/TemporalError.hpp"
#include "temporal_rs/TimeZone.hpp"
#include "temporal_rs/ToStringRoundingOptions.hpp"
#include "temporal_rs/diplomat_runtime.hpp"

namespace temporal_rs {

class PlainTime {
 public:
  // ── Static factories ──────────────────────────────────────────────

  static diplomat::result<std::unique_ptr<PlainTime>, TemporalError> try_new(
      uint8_t hour, uint8_t minute, uint8_t second, uint16_t millisecond,
      uint16_t microsecond, uint16_t nanosecond) {
    auto result = ::node::socketsecurity::temporal::PlainTimeTryNew(
        hour, minute, second, millisecond, microsecond, nanosecond);
    if (!result.ok()) {
      return diplomat::Err<TemporalError>(
          TemporalError::FromInfra(result.error()));
    }
    return diplomat::Ok<std::unique_ptr<PlainTime>>(
        std::unique_ptr<PlainTime>(new PlainTime(result.value())));
  }

  static diplomat::result<std::unique_ptr<PlainTime>, TemporalError>
  try_new_constrain(uint8_t hour, uint8_t minute, uint8_t second,
                     uint16_t millisecond, uint16_t microsecond,
                     uint16_t nanosecond) {
    auto result = ::node::socketsecurity::temporal::PlainTimeNew(
        hour, minute, second, millisecond, microsecond, nanosecond);
    if (!result.ok()) {
      return diplomat::Err<TemporalError>(
          TemporalError::FromInfra(result.error()));
    }
    return diplomat::Ok<std::unique_ptr<PlainTime>>(
        std::unique_ptr<PlainTime>(new PlainTime(result.value())));
  }

  static diplomat::result<std::unique_ptr<PlainTime>, TemporalError>
  try_new_with_overflow(uint8_t hour, uint8_t minute, uint8_t second,
                         uint16_t millisecond, uint16_t microsecond,
                         uint16_t nanosecond, ArithmeticOverflow overflow) {
    auto result = ::node::socketsecurity::temporal::PlainTimeNewWithOverflow(
        hour, minute, second, millisecond, microsecond, nanosecond,
        overflow.ToInfra());
    if (!result.ok()) {
      return diplomat::Err<TemporalError>(
          TemporalError::FromInfra(result.error()));
    }
    return diplomat::Ok<std::unique_ptr<PlainTime>>(
        std::unique_ptr<PlainTime>(new PlainTime(result.value())));
  }

  static diplomat::result<std::unique_ptr<PlainTime>, TemporalError>
  from_partial(PartialTime partial,
                std::optional<ArithmeticOverflow> overflow) {
    std::optional<::node::socketsecurity::temporal::Overflow> infra_overflow;
    if (overflow.has_value()) {
      infra_overflow = overflow->ToInfra();
    }
    auto result = ::node::socketsecurity::temporal::PlainTimeFromPartial(
        partial.ToInfra(), infra_overflow);
    if (!result.ok()) {
      return diplomat::Err<TemporalError>(
          TemporalError::FromInfra(result.error()));
    }
    return diplomat::Ok<std::unique_ptr<PlainTime>>(
        std::unique_ptr<PlainTime>(new PlainTime(result.value())));
  }

  static diplomat::result<std::unique_ptr<PlainTime>, TemporalError> from_utf8(
      std::string_view s) {
    auto result = ::node::socketsecurity::temporal::PlainTimeFromUtf8(
        reinterpret_cast<const uint8_t*>(s.data()), s.size());
    if (!result.ok()) {
      return diplomat::Err<TemporalError>(
          TemporalError::FromInfra(result.error()));
    }
    return diplomat::Ok<std::unique_ptr<PlainTime>>(
        std::unique_ptr<PlainTime>(new PlainTime(result.value())));
  }

  static diplomat::result<std::unique_ptr<PlainTime>, TemporalError>
  from_utf16(std::u16string_view s) {
    std::string narrow;
    narrow.reserve(s.size());
    for (char16_t c : s) {
      if (c > 0x7F) {
        return diplomat::Err<TemporalError>(TemporalError{
            ErrorKind::Range, "Non-ASCII character in PlainTime string"});
      }
      narrow.push_back(static_cast<char>(c));
    }
    return from_utf8(narrow);
  }

  // ── Field accessors ───────────────────────────────────────────────

  uint8_t hour() const { return inner_.iso.hour; }
  uint8_t minute() const { return inner_.iso.minute; }
  uint8_t second() const { return inner_.iso.second; }
  uint16_t millisecond() const { return inner_.iso.millisecond; }
  uint16_t microsecond() const { return inner_.iso.microsecond; }
  uint16_t nanosecond() const { return inner_.iso.nanosecond; }
  bool is_valid() const { return inner_.IsValid(); }

  // ── Mutation ──────────────────────────────────────────────────────

  diplomat::result<std::unique_ptr<PlainTime>, TemporalError> with(
      PartialTime partial,
      std::optional<ArithmeticOverflow> overflow) const {
    std::optional<::node::socketsecurity::temporal::Overflow> infra_overflow;
    if (overflow.has_value()) {
      infra_overflow = overflow->ToInfra();
    }
    auto result = ::node::socketsecurity::temporal::PlainTimeWith(
        inner_, partial.ToInfra(), infra_overflow);
    if (!result.ok()) {
      return diplomat::Err<TemporalError>(
          TemporalError::FromInfra(result.error()));
    }
    return diplomat::Ok<std::unique_ptr<PlainTime>>(
        std::unique_ptr<PlainTime>(new PlainTime(result.value())));
  }

  // ── Comparison ────────────────────────────────────────────────────

  bool equals(const PlainTime& other) const {
    return inner_.iso.hour == other.inner_.iso.hour &&
           inner_.iso.minute == other.inner_.iso.minute &&
           inner_.iso.second == other.inner_.iso.second &&
           inner_.iso.millisecond == other.inner_.iso.millisecond &&
           inner_.iso.microsecond == other.inner_.iso.microsecond &&
           inner_.iso.nanosecond == other.inner_.iso.nanosecond;
  }

  static int8_t compare(const PlainTime& one, const PlainTime& two) {
    auto cmp = [](auto a, auto b) -> int8_t {
      if (a < b) return -1;
      if (a > b) return 1;
      return 0;
    };
    int8_t r;
    if ((r = cmp(one.inner_.iso.hour, two.inner_.iso.hour))) return r;
    if ((r = cmp(one.inner_.iso.minute, two.inner_.iso.minute))) return r;
    if ((r = cmp(one.inner_.iso.second, two.inner_.iso.second))) return r;
    if ((r = cmp(one.inner_.iso.millisecond, two.inner_.iso.millisecond)))
      return r;
    if ((r = cmp(one.inner_.iso.microsecond, two.inner_.iso.microsecond)))
      return r;
    return cmp(one.inner_.iso.nanosecond, two.inner_.iso.nanosecond);
  }

  std::unique_ptr<PlainTime> clone() const {
    return std::unique_ptr<PlainTime>(new PlainTime(inner_));
  }

  // ── Arithmetic ─────────────────────────────────────────────────

  template <class D>
  diplomat::result<std::unique_ptr<PlainTime>, TemporalError> add(
      const D& duration) const {
    auto r = ::node::socketsecurity::temporal::PlainTimeAdd(
        inner_, duration.ToInfra());
    if (!r.ok()) {
      return diplomat::Err<TemporalError>(
          TemporalError::FromInfra(r.error()));
    }
    return diplomat::Ok<std::unique_ptr<PlainTime>>(
        std::unique_ptr<PlainTime>(new PlainTime(r.value())));
  }

  template <class D>
  diplomat::result<std::unique_ptr<PlainTime>, TemporalError> subtract(
      const D& duration) const {
    auto r = ::node::socketsecurity::temporal::PlainTimeSubtract(
        inner_, duration.ToInfra());
    if (!r.ok()) {
      return diplomat::Err<TemporalError>(
          TemporalError::FromInfra(r.error()));
    }
    return diplomat::Ok<std::unique_ptr<PlainTime>>(
        std::unique_ptr<PlainTime>(new PlainTime(r.value())));
  }

  template <class D, class S>
  diplomat::result<std::unique_ptr<D>, TemporalError> since(
      const PlainTime& other, S /*settings*/) const {
    auto r = ::node::socketsecurity::temporal::PlainTimeSince(
        inner_, other.inner_);
    if (!r.ok()) {
      return diplomat::Err<TemporalError>(
          TemporalError::FromInfra(r.error()));
    }
    return diplomat::Ok<std::unique_ptr<D>>(D::FromInfra(r.value()));
  }

  template <class D, class S>
  diplomat::result<std::unique_ptr<D>, TemporalError> until(
      const PlainTime& other, S /*settings*/) const {
    auto r = ::node::socketsecurity::temporal::PlainTimeUntil(
        inner_, other.inner_);
    if (!r.ok()) {
      return diplomat::Err<TemporalError>(
          TemporalError::FromInfra(r.error()));
    }
    return diplomat::Ok<std::unique_ptr<D>>(D::FromInfra(r.value()));
  }

  diplomat::result<std::unique_ptr<PlainTime>, TemporalError> round(
      const ::temporal_rs::RoundingOptions& options) const {
    auto r = ::node::socketsecurity::temporal::PlainTimeRound(
        inner_, options.ToInfra());
    if (!r.ok()) {
      return diplomat::Err<TemporalError>(
          TemporalError::FromInfra(r.error()));
    }
    return diplomat::Ok<std::unique_ptr<PlainTime>>(
        std::unique_ptr<PlainTime>(new PlainTime(r.value())));
  }

  // ── Bridges ────────────────────────────────────────────────────

  const ::node::socketsecurity::temporal::PlainTime& ToInfra() const {
    return inner_;
  }

  static std::unique_ptr<PlainTime> FromInfra(
      const ::node::socketsecurity::temporal::PlainTime& d) {
    return std::unique_ptr<PlainTime>(new PlainTime(d));
  }

  PlainTime() = delete;
  PlainTime(const PlainTime&) = delete;
  PlainTime(PlainTime&&) noexcept = delete;
  PlainTime& operator=(const PlainTime&) = delete;
  PlainTime& operator=(PlainTime&&) noexcept = delete;

  diplomat::result<std::string, TemporalError>
  to_ixdtf_string(ToStringRoundingOptions /*options*/) const {
    return diplomat::Ok<std::string>(std::string{});
  }

 private:
  explicit PlainTime(::node::socketsecurity::temporal::PlainTime inner)
      : inner_(inner) {}

  ::node::socketsecurity::temporal::PlainTime inner_;
};

}  // namespace temporal_rs

#endif  // TEMPORAL_RS_COMPAT_PLAINTIME_HPP_
