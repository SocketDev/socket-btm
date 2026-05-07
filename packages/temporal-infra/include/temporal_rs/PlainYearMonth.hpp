// Compat shim: temporal_rs::PlainYearMonth.

#ifndef TEMPORAL_RS_COMPAT_PLAINYEARMONTH_HPP_
#define TEMPORAL_RS_COMPAT_PLAINYEARMONTH_HPP_

#include <cstdint>
#include <memory>
#include <optional>
#include <string>
#include <string_view>

#include "socketsecurity/temporal/plain_year_month.h"
#include "temporal_rs/AnyCalendarKind.hpp"
#include "temporal_rs/TemporalError.hpp"
#include "temporal_rs/diplomat_runtime.hpp"

namespace temporal_rs {

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
