// Compat shim: temporal_rs::PlainMonthDay.

#ifndef TEMPORAL_RS_COMPAT_PLAINMONTHDAY_HPP_
#define TEMPORAL_RS_COMPAT_PLAINMONTHDAY_HPP_

#include <cstdint>
#include <memory>
#include <optional>
#include <string>
#include <string_view>

#include "socketsecurity/temporal/plain_month_day.h"
#include "temporal_rs/AnyCalendarKind.hpp"
#include "temporal_rs/TemporalError.hpp"
#include "temporal_rs/diplomat_runtime.hpp"

namespace temporal_rs {

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

  uint8_t month() const {
    return ::node::socketsecurity::temporal::PlainMonthDayMonth(inner_);
  }
  uint8_t day() const {
    return ::node::socketsecurity::temporal::PlainMonthDayDay(inner_);
  }
  bool is_valid() const { return inner_.IsValid(); }

  std::unique_ptr<PlainMonthDay> clone() const {
    return std::unique_ptr<PlainMonthDay>(new PlainMonthDay(inner_));
  }

  // Phase 10c TODO: with / equals / compare / to_plain_date /
  // to_ixdtf_string.

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
