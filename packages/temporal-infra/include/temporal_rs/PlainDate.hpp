// Compat shim: temporal_rs::PlainDate. Heap-owned wrapper around
// node::socketsecurity::temporal::PlainDate. Matches upstream's
// diplomat-conventions surface (non-copyable, unique_ptr factories).

#ifndef TEMPORAL_RS_COMPAT_PLAINDATE_HPP_
#define TEMPORAL_RS_COMPAT_PLAINDATE_HPP_

#include <cstdint>
#include <memory>
#include <optional>
#include <string>
#include <string_view>

#include "socketsecurity/temporal/parse.h"
#include "socketsecurity/temporal/plain_date.h"
#include "temporal_rs/AnyCalendarKind.hpp"
#include "temporal_rs/ArithmeticOverflow.hpp"
#include "temporal_rs/PartialDate.hpp"
#include "temporal_rs/TemporalError.hpp"
#include "temporal_rs/diplomat_runtime.hpp"

namespace temporal_rs {

// Forward decls — full surface in their own headers (Phase 10c+).
class Duration;
class PlainDateTime;
class PlainMonthDay;
class PlainYearMonth;
class ParsedDate;
struct DifferenceSettings;
struct TimeZone;

class PlainDate {
 public:
  // ── Static factories ──────────────────────────────────────────────

  static diplomat::result<std::unique_ptr<PlainDate>, TemporalError> try_new(
      int32_t year, uint8_t month, uint8_t day,
      AnyCalendarKind /*calendar*/) {
    auto result =
        ::node::socketsecurity::temporal::PlainDateTryNewIso(year, month, day);
    if (!result.ok()) {
      return diplomat::Err<TemporalError>(
          TemporalError::FromInfra(result.error()));
    }
    return diplomat::Ok<std::unique_ptr<PlainDate>>(
        std::unique_ptr<PlainDate>(new PlainDate(result.value())));
  }

  static diplomat::result<std::unique_ptr<PlainDate>, TemporalError>
  try_new_constrain(int32_t year, uint8_t month, uint8_t day,
                     AnyCalendarKind /*calendar*/) {
    auto result = ::node::socketsecurity::temporal::PlainDateNewWithOverflow(
        year, month, day,
        ::node::socketsecurity::temporal::Overflow::kConstrain);
    if (!result.ok()) {
      return diplomat::Err<TemporalError>(
          TemporalError::FromInfra(result.error()));
    }
    return diplomat::Ok<std::unique_ptr<PlainDate>>(
        std::unique_ptr<PlainDate>(new PlainDate(result.value())));
  }

  static diplomat::result<std::unique_ptr<PlainDate>, TemporalError>
  try_new_with_overflow(int32_t year, uint8_t month, uint8_t day,
                         AnyCalendarKind /*calendar*/,
                         ArithmeticOverflow overflow) {
    auto result = ::node::socketsecurity::temporal::PlainDateNewWithOverflow(
        year, month, day, overflow.ToInfra());
    if (!result.ok()) {
      return diplomat::Err<TemporalError>(
          TemporalError::FromInfra(result.error()));
    }
    return diplomat::Ok<std::unique_ptr<PlainDate>>(
        std::unique_ptr<PlainDate>(new PlainDate(result.value())));
  }

  static diplomat::result<std::unique_ptr<PlainDate>, TemporalError>
  from_partial(PartialDate partial,
                std::optional<ArithmeticOverflow> overflow) {
    std::optional<::node::socketsecurity::temporal::Overflow> infra_overflow;
    if (overflow.has_value()) {
      infra_overflow = overflow->ToInfra();
    }
    auto result = ::node::socketsecurity::temporal::PlainDateFromPartial(
        partial.ToInfra(), infra_overflow);
    if (!result.ok()) {
      return diplomat::Err<TemporalError>(
          TemporalError::FromInfra(result.error()));
    }
    return diplomat::Ok<std::unique_ptr<PlainDate>>(
        std::unique_ptr<PlainDate>(new PlainDate(result.value())));
  }

  static diplomat::result<std::unique_ptr<PlainDate>, TemporalError> from_utf8(
      std::string_view s) {
    auto result = ::node::socketsecurity::temporal::PlainDateFromUtf8(
        reinterpret_cast<const uint8_t*>(s.data()), s.size());
    if (!result.ok()) {
      return diplomat::Err<TemporalError>(
          TemporalError::FromInfra(result.error()));
    }
    return diplomat::Ok<std::unique_ptr<PlainDate>>(
        std::unique_ptr<PlainDate>(new PlainDate(result.value())));
  }

  static diplomat::result<std::unique_ptr<PlainDate>, TemporalError>
  from_utf16(std::u16string_view s) {
    std::string narrow;
    narrow.reserve(s.size());
    for (char16_t c : s) {
      if (c > 0x7F) {
        return diplomat::Err<TemporalError>(TemporalError{
            ErrorKind::Range, "Non-ASCII character in PlainDate string"});
      }
      narrow.push_back(static_cast<char>(c));
    }
    return from_utf8(narrow);
  }

  // ── Field accessors ───────────────────────────────────────────────

  int32_t year() const {
    return ::node::socketsecurity::temporal::PlainDateYear(inner_);
  }
  uint8_t month() const {
    return ::node::socketsecurity::temporal::PlainDateMonth(inner_);
  }
  uint8_t day() const {
    return ::node::socketsecurity::temporal::PlainDateDay(inner_);
  }
  uint8_t day_of_week() const {
    return ::node::socketsecurity::temporal::PlainDateDayOfWeek(inner_);
  }
  uint16_t day_of_year() const {
    return ::node::socketsecurity::temporal::PlainDateDayOfYear(inner_);
  }
  uint8_t week_of_year() const {
    return ::node::socketsecurity::temporal::PlainDateWeekOfYear(inner_);
  }
  uint8_t days_in_month() const {
    return ::node::socketsecurity::temporal::PlainDateDaysInMonth(inner_);
  }
  uint16_t days_in_year() const {
    return ::node::socketsecurity::temporal::PlainDateDaysInYear(inner_);
  }
  bool in_leap_year() const {
    return ::node::socketsecurity::temporal::PlainDateInLeapYear(inner_);
  }

  bool is_valid() const { return inner_.IsValid(); }

  // ── Mutation (returns new heap-owned PlainDate) ───────────────────

  diplomat::result<std::unique_ptr<PlainDate>, TemporalError> with(
      PartialDate partial,
      std::optional<ArithmeticOverflow> overflow) const {
    std::optional<::node::socketsecurity::temporal::Overflow> infra_overflow;
    if (overflow.has_value()) {
      infra_overflow = overflow->ToInfra();
    }
    auto result = ::node::socketsecurity::temporal::PlainDateWith(
        inner_, partial.ToInfra(), infra_overflow);
    if (!result.ok()) {
      return diplomat::Err<TemporalError>(
          TemporalError::FromInfra(result.error()));
    }
    return diplomat::Ok<std::unique_ptr<PlainDate>>(
        std::unique_ptr<PlainDate>(new PlainDate(result.value())));
  }

  // ── Comparison ────────────────────────────────────────────────────

  bool equals(const PlainDate& other) const {
    return inner_.iso.year == other.inner_.iso.year &&
           inner_.iso.month == other.inner_.iso.month &&
           inner_.iso.day == other.inner_.iso.day;
  }

  static int8_t compare(const PlainDate& one, const PlainDate& two) {
    if (one.inner_.iso.year != two.inner_.iso.year) {
      return one.inner_.iso.year < two.inner_.iso.year ? -1 : 1;
    }
    if (one.inner_.iso.month != two.inner_.iso.month) {
      return one.inner_.iso.month < two.inner_.iso.month ? -1 : 1;
    }
    if (one.inner_.iso.day != two.inner_.iso.day) {
      return one.inner_.iso.day < two.inner_.iso.day ? -1 : 1;
    }
    return 0;
  }

  // ── Clone ─────────────────────────────────────────────────────────

  std::unique_ptr<PlainDate> clone() const {
    return std::unique_ptr<PlainDate>(new PlainDate(inner_));
  }

  // ── Methods needing more shim plumbing (Phase 10c) ────────────────
  //
  //   add(Duration, optional<Overflow>)
  //   subtract(Duration, optional<Overflow>)
  //   since(PlainDate&, DifferenceSettings)
  //   until(PlainDate&, DifferenceSettings)
  //   with_calendar(AnyCalendarKind) → unique_ptr<PlainDate> (no error)
  //   from_parsed(ParsedDate&)
  //   from_epoch_milliseconds[_with_provider](int64_t, TimeZone[, Provider])
  //   from_epoch_nanoseconds[_with_provider](I128Nanoseconds, TimeZone[, Provider])
  //   to_plain_year_month()
  //   to_plain_month_day()
  //   to_plain_date_time(optional<PlainTime>)
  //   to_zoned_date_time(TimeZone, optional<PlainTime>)
  //   to_ixdtf_string(DisplayCalendar)
  //   calendar() → const Calendar&
  //
  // These all need their respective heavyweight shim types (Duration,
  // PlainDateTime, ZonedDateTime, etc.) wired up first.

  // ── Forbidden ops ─────────────────────────────────────────────────
  PlainDate() = delete;
  PlainDate(const PlainDate&) = delete;
  PlainDate(PlainDate&&) noexcept = delete;
  PlainDate& operator=(const PlainDate&) = delete;
  PlainDate& operator=(PlainDate&&) noexcept = delete;

 private:
  explicit PlainDate(::node::socketsecurity::temporal::PlainDate inner)
      : inner_(inner) {}

  ::node::socketsecurity::temporal::PlainDate inner_;
};

}  // namespace temporal_rs

#endif  // TEMPORAL_RS_COMPAT_PLAINDATE_HPP_
