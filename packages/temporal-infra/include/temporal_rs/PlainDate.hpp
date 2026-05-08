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
#include "socketsecurity/temporal/plain_date_time.h"
#include "temporal_rs/AnyCalendarKind.hpp"
#include "temporal_rs/ArithmeticOverflow.hpp"
#include "temporal_rs/Calendar.hpp"
#include "temporal_rs/PartialDate.hpp"
#include "temporal_rs/Provider.hpp"
#include "temporal_rs/TemporalError.hpp"
#include "temporal_rs/diplomat_runtime.hpp"

namespace temporal_rs {

// Forward decls - full surface in their own headers (Phase 10c+).
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

  // Calendar-aware accessors. Calendar-backend integration is
  // pending; these stub to ISO-equivalent or empty defaults so V8
  // links. Real values land when calendar.cc activates the non-ISO
  // paths.
  Calendar calendar() const {
    return Calendar(::node::socketsecurity::temporal::Calendar::Iso());
  }
  uint8_t days_in_week() const { return 7; }
  uint8_t months_in_year() const { return 12; }
  std::string month_code() const { return ""; }
  std::string era() const { return ""; }
  std::optional<int32_t> era_year() const { return std::nullopt; }
  std::optional<int32_t> year_of_week() const { return std::nullopt; }

  // Conversions: PlainDate -> PlainDateTime / ZonedDateTime.
  // Templated on the consumer types to keep includes one-way
  // (PlainDateTime / ZonedDateTime aren't visible here).
  template <class PT, class PDT>
  diplomat::result<std::unique_ptr<PDT>, TemporalError> to_plain_date_time(
      std::optional<const PT*> /*time*/) const {
    auto r = ::node::socketsecurity::temporal::PlainDateTimeTryNew(
        inner_.iso.year, inner_.iso.month, inner_.iso.day, 0, 0, 0, 0, 0, 0);
    if (!r.ok()) {
      return diplomat::Err<TemporalError>(
          TemporalError::FromInfra(r.error()));
    }
    return diplomat::Ok<std::unique_ptr<PDT>>(PDT::FromInfra(r.value()));
  }

  // Stub: requires calendar-aware projection plus DST-anchored
  // conversion. Returns an error until the path activates.
  template <class ZDT, class TZ>
  diplomat::result<std::unique_ptr<ZDT>, TemporalError>
  to_zoned_date_time_with_provider(const TZ& /*tz*/,
                                     const Provider& /*p*/) const {
    return diplomat::Err<TemporalError>(TemporalError{
        ErrorKind::Range,
        "PlainDate.toZonedDateTime requires temporal-infra calendar backend"});
  }

  diplomat::result<std::unique_ptr<PlainDate>, TemporalError> with_calendar(
      AnyCalendarKind /*kind*/) const {
    // Calendar-aware projection lands with calendar.cc; for now,
    // return a clone (ISO-only path).
    return diplomat::Ok<std::unique_ptr<PlainDate>>(
        std::unique_ptr<PlainDate>(new PlainDate(inner_)));
  }

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

  // ── Arithmetic ────────────────────────────────────────────────────
  //
  // Templated on the Duration shim type to break the
  // Duration.hpp ↔ PlainDate.hpp include cycle.

  template <class D>
  diplomat::result<std::unique_ptr<PlainDate>, TemporalError> add(
      const D& duration,
      std::optional<ArithmeticOverflow> overflow) const {
    std::optional<::node::socketsecurity::temporal::Overflow> infra_overflow;
    if (overflow.has_value()) {
      infra_overflow = overflow->ToInfra();
    }
    auto result = ::node::socketsecurity::temporal::PlainDateAdd(
        inner_, duration.ToInfra(), infra_overflow);
    if (!result.ok()) {
      return diplomat::Err<TemporalError>(
          TemporalError::FromInfra(result.error()));
    }
    return diplomat::Ok<std::unique_ptr<PlainDate>>(
        std::unique_ptr<PlainDate>(new PlainDate(result.value())));
  }

  template <class D>
  diplomat::result<std::unique_ptr<PlainDate>, TemporalError> subtract(
      const D& duration,
      std::optional<ArithmeticOverflow> overflow) const {
    std::optional<::node::socketsecurity::temporal::Overflow> infra_overflow;
    if (overflow.has_value()) {
      infra_overflow = overflow->ToInfra();
    }
    auto result = ::node::socketsecurity::temporal::PlainDateSubtract(
        inner_, duration.ToInfra(), infra_overflow);
    if (!result.ok()) {
      return diplomat::Err<TemporalError>(
          TemporalError::FromInfra(result.error()));
    }
    return diplomat::Ok<std::unique_ptr<PlainDate>>(
        std::unique_ptr<PlainDate>(new PlainDate(result.value())));
  }

  template <class D, class S>
  diplomat::result<std::unique_ptr<D>, TemporalError> since(
      const PlainDate& other, S /*settings*/) const {
    // settings (rounding / largest-unit / smallest-unit) layer onto a
    // post-difference round; the underlying infra returns the
    // ISO-day-difference Duration. The shim's Duration::round handles
    // the settings application separately.
    auto result = ::node::socketsecurity::temporal::PlainDateSince(
        inner_, other.inner_);
    if (!result.ok()) {
      return diplomat::Err<TemporalError>(
          TemporalError::FromInfra(result.error()));
    }
    return diplomat::Ok<std::unique_ptr<D>>(D::FromInfra(result.value()));
  }

  template <class D, class S>
  diplomat::result<std::unique_ptr<D>, TemporalError> until(
      const PlainDate& other, S /*settings*/) const {
    auto result = ::node::socketsecurity::temporal::PlainDateUntil(
        inner_, other.inner_);
    if (!result.ok()) {
      return diplomat::Err<TemporalError>(
          TemporalError::FromInfra(result.error()));
    }
    return diplomat::Ok<std::unique_ptr<D>>(D::FromInfra(result.value()));
  }

  // ── Bridges ─────────────────────────────────────────────────────

  const ::node::socketsecurity::temporal::PlainDate& ToInfra() const {
    return inner_;
  }

  static std::unique_ptr<PlainDate> FromInfra(
      const ::node::socketsecurity::temporal::PlainDate& d) {
    return std::unique_ptr<PlainDate>(new PlainDate(d));
  }

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
