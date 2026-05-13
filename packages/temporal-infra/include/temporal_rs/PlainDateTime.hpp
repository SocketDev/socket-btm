// Compat shim: temporal_rs::PlainDateTime. Heap-owned wrapper.

#ifndef TEMPORAL_RS_COMPAT_PLAINDATETIME_HPP_
#define TEMPORAL_RS_COMPAT_PLAINDATETIME_HPP_

#include <cstdint>
#include <memory>
#include <optional>
#include <string>
#include <string_view>

#include "socketsecurity/temporal/iso.h"
#include "socketsecurity/temporal/ixdtf_writer.h"
#include "socketsecurity/temporal/plain_date.h"
#include "socketsecurity/temporal/plain_date_time.h"
#include "temporal_rs/AnyCalendarKind.hpp"
#include "temporal_rs/ArithmeticOverflow.hpp"
#include "temporal_rs/Calendar.hpp"
#include "temporal_rs/DifferenceSettings.hpp"
#include "temporal_rs/Disambiguation.hpp"
#include "temporal_rs/DisplayCalendar.hpp"
#include "temporal_rs/Duration.hpp"
#include "temporal_rs/I128Nanoseconds.hpp"
#include "temporal_rs/ParsedDateTime.hpp"
#include "temporal_rs/PartialDateTime.hpp"
#include "temporal_rs/PlainDate.hpp"
#include "temporal_rs/PlainTime.hpp"
#include "temporal_rs/Provider.hpp"
#include "temporal_rs/RoundingOptions.hpp"
#include "temporal_rs/TemporalError.hpp"
#include "temporal_rs/TimeZone.hpp"
#include "temporal_rs/diplomat_runtime.hpp"

namespace temporal_rs {

struct RoundingOptions;

class PlainDateTime {
 public:
  static diplomat::result<std::unique_ptr<PlainDateTime>, TemporalError>
  try_new(int32_t year, uint8_t month, uint8_t day, uint8_t hour,
           uint8_t minute, uint8_t second, uint16_t millisecond,
           uint16_t microsecond, uint16_t nanosecond,
           AnyCalendarKind calendar) {
    auto result = ::node::socketsecurity::temporal::PlainDateTimeTryNew(
        year, month, day, hour, minute, second, millisecond, microsecond,
        nanosecond);
    if (!result.ok()) {
      return diplomat::Err<TemporalError>(
          TemporalError::FromInfra(result.error()));
    }
    auto pdt = result.value();
    pdt.calendar = calendar.ToInfra();
    return diplomat::Ok<std::unique_ptr<PlainDateTime>>(
        std::unique_ptr<PlainDateTime>(new PlainDateTime(pdt)));
  }

  static diplomat::result<std::unique_ptr<PlainDateTime>, TemporalError>
  try_new_with_overflow(int32_t year, uint8_t month, uint8_t day,
                         uint8_t hour, uint8_t minute, uint8_t second,
                         uint16_t millisecond, uint16_t microsecond,
                         uint16_t nanosecond, AnyCalendarKind calendar,
                         ArithmeticOverflow overflow) {
    auto result =
        ::node::socketsecurity::temporal::PlainDateTimeNewWithOverflow(
            year, month, day, hour, minute, second, millisecond, microsecond,
            nanosecond, overflow.ToInfra());
    if (!result.ok()) {
      return diplomat::Err<TemporalError>(
          TemporalError::FromInfra(result.error()));
    }
    auto pdt = result.value();
    pdt.calendar = calendar.ToInfra();
    return diplomat::Ok<std::unique_ptr<PlainDateTime>>(
        std::unique_ptr<PlainDateTime>(new PlainDateTime(pdt)));
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
    auto pdt = result.value();
    pdt.calendar = partial.date.calendar.ToInfra();
    return diplomat::Ok<std::unique_ptr<PlainDateTime>>(
        std::unique_ptr<PlainDateTime>(new PlainDateTime(pdt)));
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

  // Build a PlainDateTime from an already-parsed ParsedDateTime. Same
  // pattern as PlainDate::from_parsed — the ISO try-new only knows about
  // year/month/day/time-of-day, so the parsed calendar kind is layered
  // on top so [u-ca=...] annotations survive ParsedDateTime → V8 PD.
  static diplomat::result<std::unique_ptr<PlainDateTime>, TemporalError>
  from_parsed(const ParsedDateTime& parsed) {
    auto r = ::node::socketsecurity::temporal::PlainDateTimeTryNew(
        parsed.year(), parsed.month(), parsed.day(), parsed.hour(),
        parsed.minute(), parsed.second(), parsed.millisecond(),
        parsed.microsecond(), parsed.nanosecond());
    if (!r.ok()) {
      return diplomat::Err<TemporalError>(
          TemporalError::FromInfra(r.error()));
    }
    ::node::socketsecurity::temporal::PlainDateTime inner = r.value();
    inner.calendar =
        static_cast<::node::socketsecurity::temporal::CalendarKind>(
            parsed.ToInfra().date.calendar_kind);
    return diplomat::Ok<std::unique_ptr<PlainDateTime>>(
        std::unique_ptr<PlainDateTime>(new PlainDateTime(inner)));
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

  // Calendar-aware accessors. Inner POD carries CalendarKind; non-ISO
  // answers route through the active CalendarBackend (V8 installs the
  // ICU-backed override at boot — see icu_cal_backend.h).
  Calendar calendar() const {
    return Calendar(
        ::node::socketsecurity::temporal::Calendar(inner_.calendar));
  }
  uint8_t day_of_week() const {
    // Day-of-week is calendar-independent (ISO calendar weeks).
    return ::node::socketsecurity::temporal::PlainDateDayOfWeek(
        ::node::socketsecurity::temporal::PlainDate{inner_.iso.date,
                                                       inner_.calendar});
  }
  uint16_t day_of_year() const {
    return ::node::socketsecurity::temporal::PlainDateDayOfYear(
        ::node::socketsecurity::temporal::PlainDate{inner_.iso.date,
                                                       inner_.calendar});
  }
  uint8_t days_in_week() const {
    ::node::socketsecurity::temporal::Calendar cal(inner_.calendar);
    return ::node::socketsecurity::temporal::CalendarDaysInWeek(
        cal, inner_.iso.date);
  }
  uint8_t days_in_month() const {
    ::node::socketsecurity::temporal::Calendar cal(inner_.calendar);
    return ::node::socketsecurity::temporal::CalendarDaysInMonth(
        cal, inner_.iso.date);
  }
  uint16_t days_in_year() const {
    ::node::socketsecurity::temporal::Calendar cal(inner_.calendar);
    return ::node::socketsecurity::temporal::CalendarDaysInYear(
        cal, inner_.iso.date);
  }
  uint8_t months_in_year() const {
    ::node::socketsecurity::temporal::Calendar cal(inner_.calendar);
    return ::node::socketsecurity::temporal::CalendarMonthsInYear(
        cal, inner_.iso.date);
  }
  bool in_leap_year() const {
    ::node::socketsecurity::temporal::Calendar cal(inner_.calendar);
    return ::node::socketsecurity::temporal::CalendarInLeapYear(
        cal, inner_.iso.date);
  }
  std::optional<uint8_t> week_of_year() const { return std::nullopt; }
  std::optional<int32_t> year_of_week() const {
    return std::optional<int32_t>(
        ::node::socketsecurity::temporal::ISOYearOfWeek(
            inner_.iso.date.year, inner_.iso.date.month,
            inner_.iso.date.day));
  }
  std::string month_code() const {
    ::node::socketsecurity::temporal::Calendar cal(inner_.calendar);
    return ::node::socketsecurity::temporal::CalendarMonthCode(cal,
                                                                  inner_.iso.date);
  }
  std::string era() const {
    ::node::socketsecurity::temporal::Calendar cal(inner_.calendar);
    return ::node::socketsecurity::temporal::CalendarEra(cal, inner_.iso.date);
  }
  std::optional<int32_t> era_year() const {
    ::node::socketsecurity::temporal::Calendar cal(inner_.calendar);
    return ::node::socketsecurity::temporal::CalendarEraYear(cal,
                                                                inner_.iso.date);
  }

  bool equals(const PlainDateTime& other) const {
    return inner_.iso.date.year == other.inner_.iso.date.year &&
           inner_.iso.date.month == other.inner_.iso.date.month &&
           inner_.iso.date.day == other.inner_.iso.date.day &&
           inner_.iso.time.hour == other.inner_.iso.time.hour &&
           inner_.iso.time.minute == other.inner_.iso.time.minute &&
           inner_.iso.time.second == other.inner_.iso.time.second &&
           inner_.iso.time.millisecond == other.inner_.iso.time.millisecond &&
           inner_.iso.time.microsecond == other.inner_.iso.time.microsecond &&
           inner_.iso.time.nanosecond == other.inner_.iso.time.nanosecond;
  }

  // 1:1 from upstream plain_date_time.rs `round`. Resolves the
  // RoundingOptions then delegates to RoundIsoDateTime, which handles
  // the time-rounding plus carry-into-date.
  diplomat::result<std::unique_ptr<PlainDateTime>, TemporalError> round(
      const RoundingOptions& options) const {
    auto resolved =
        ::node::socketsecurity::temporal::ResolvedRoundingOptionsFromDateTime(
            options.ToInfra());
    if (!resolved.ok()) {
      return diplomat::Err<TemporalError>(
          TemporalError::FromInfra(resolved.error()));
    }
    auto rounded = ::node::socketsecurity::temporal::RoundIsoDateTime(
        inner_.iso, resolved.value());
    if (!rounded.ok()) {
      return diplomat::Err<TemporalError>(
          TemporalError::FromInfra(rounded.error()));
    }
    ::node::socketsecurity::temporal::PlainDateTime out{};
    out.iso = rounded.value();
    if (!out.IsValid()) {
      return diplomat::Err<TemporalError>(TemporalError{
          ErrorKind::Range,
          "PlainDateTime.round result outside valid range"});
    }
    return diplomat::Ok<std::unique_ptr<PlainDateTime>>(
        PlainDateTime::FromInfra(out));
  }

  // 1:1 from upstream plain_date_time.rs `with_time`. Replaces the
  // time portion while keeping the date. Null time = midnight per
  // spec. The date portion comes from this->inner_.iso.date which
  // was already validated when the receiver was constructed.
  diplomat::result<std::unique_ptr<PlainDateTime>, TemporalError> with_time(
      const PlainTime* time) const {
    ::node::socketsecurity::temporal::PlainDateTime out{};
    out.iso.date = inner_.iso.date;
    if (time != nullptr) {
      out.iso.time = time->ToInfra().iso;
    }
    if (!out.IsValid()) {
      return diplomat::Err<TemporalError>(TemporalError{
          ErrorKind::Range,
          "PlainDateTime invalid after time replacement"});
    }
    return diplomat::Ok<std::unique_ptr<PlainDateTime>>(
        std::unique_ptr<PlainDateTime>(new PlainDateTime(out)));
  }

  // 1:1 from upstream plain_date_time.rs `with`. Delegates to the
  // pre-existing PlainDateTimeWith helper in plain_date_time.cc.
  diplomat::result<std::unique_ptr<PlainDateTime>, TemporalError> with(
      PartialDateTime partial,
      std::optional<ArithmeticOverflow> overflow) const {
    std::optional<::node::socketsecurity::temporal::Overflow> infra_overflow;
    if (overflow.has_value()) {
      infra_overflow = overflow->ToInfra();
    }
    auto result = ::node::socketsecurity::temporal::PlainDateTimeWith(
        inner_, partial.ToInfra(), infra_overflow);
    if (!result.ok()) {
      return diplomat::Err<TemporalError>(
          TemporalError::FromInfra(result.error()));
    }
    return diplomat::Ok<std::unique_ptr<PlainDateTime>>(
        PlainDateTime::FromInfra(result.value()));
  }

  // Upstream is a static method: PlainDateTime::compare(a, b).
  // Lexicographic compare over ISO fields (year → nanosecond). Returns
  // -1 / 0 / 1 matching upstream temporal_rs semantics; calendar is
  // intentionally ignored because every PlainDateTime is normalized to
  // ISO at construction.
  static int8_t compare(const PlainDateTime& one, const PlainDateTime& two) {
    const auto& a = one.inner_.iso;
    const auto& b = two.inner_.iso;
    auto cmp = [](auto x, auto y) -> int8_t {
      return x < y ? -1 : (x > y ? 1 : 0);
    };
    if (auto c = cmp(a.date.year, b.date.year); c != 0) {
      return c;
    }
    if (auto c = cmp(a.date.month, b.date.month); c != 0) {
      return c;
    }
    if (auto c = cmp(a.date.day, b.date.day); c != 0) {
      return c;
    }
    if (auto c = cmp(a.time.hour, b.time.hour); c != 0) {
      return c;
    }
    if (auto c = cmp(a.time.minute, b.time.minute); c != 0) {
      return c;
    }
    if (auto c = cmp(a.time.second, b.time.second); c != 0) {
      return c;
    }
    if (auto c = cmp(a.time.millisecond, b.time.millisecond); c != 0) {
      return c;
    }
    if (auto c = cmp(a.time.microsecond, b.time.microsecond); c != 0) {
      return c;
    }
    return cmp(a.time.nanosecond, b.time.nanosecond);
  }

  // 1:1 from upstream plain_date_time.rs:937 / :961.
  diplomat::result<std::string, TemporalError> to_ixdtf_string(
      ToStringRoundingOptions options,
      DisplayCalendar display_calendar) const {
    auto resolved =
        ::node::socketsecurity::temporal::ToStringRoundingOptionsResolve(
            options.ToInfra());
    if (!resolved.ok()) {
      return diplomat::Err<TemporalError>(
          TemporalError::FromInfra(resolved.error()));
    }
    auto rounding_options =
        ::node::socketsecurity::temporal::ResolvedRoundingOptionsFromToString(
            resolved.value());
    auto rounded = ::node::socketsecurity::temporal::RoundIsoDateTime(
        inner_.iso, rounding_options);
    if (!rounded.ok()) {
      return diplomat::Err<TemporalError>(
          TemporalError::FromInfra(rounded.error()));
    }
    return diplomat::Ok<std::string>(
        ::node::socketsecurity::temporal::IxdtfStringBuilder()
            .WithDate(rounded.value().date)
            .WithTime(rounded.value().time, resolved.value().precision)
            .WithCalendar("iso8601", display_calendar.ToInfra())
            .Build());
  }

  // Upstream: returns plain unique_ptr (no result wrap, no error case).
  std::unique_ptr<PlainDateTime> with_calendar(
      AnyCalendarKind /*kind*/) const {
    return std::unique_ptr<PlainDateTime>(new PlainDateTime(inner_));
  }

  // 1:1 from upstream plain_date_time.rs `to_zoned_date_time`.
  // Resolves the wall-clock IsoDateTime to epoch-ns via
  // TimeZone::GetEpochNanosecondsFor, then constructs a
  // ZonedDateTime. For offset-only TZs (UTC, "+05:00", etc.) this
  // works directly; for IANA TZs the active TimeZoneBackend must
  // resolve the wall clock against its DST transition table.
  // Body lives at the tail of ZonedDateTime.hpp where the
  // ZonedDateTime class is complete (this header forward-declares it).
  diplomat::result<std::unique_ptr<ZonedDateTime>, TemporalError>
  to_zoned_date_time(TimeZone tz, Disambiguation disamb) const;

  diplomat::result<std::unique_ptr<ZonedDateTime>, TemporalError>
  to_zoned_date_time_with_provider(TimeZone tz,
                                    Disambiguation disamb,
                                    const Provider& /*p*/) const {
    return to_zoned_date_time(tz, disamb);
  }

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

// ── Cross-class out-of-line definitions ──────────────────────────────
// PlainDate::to_plain_date_time needs both PlainTime (for ToInfra)
// and PlainDateTime (for FromInfra) complete. PlainDate.hpp can only
// forward-declare both because PlainDateTime.hpp already includes
// PlainDate.hpp; the body lives here at the tail where everything is
// complete.

inline diplomat::result<std::unique_ptr<PlainDateTime>, TemporalError>
PlainDate::to_plain_date_time(const PlainTime* time) const {
  ::node::socketsecurity::temporal::PlainDateTime out{};
  out.iso.date = inner_.iso;
  out.calendar = inner_.calendar;
  if (time != nullptr) {
    out.iso.time = time->ToInfra().iso;
  }
  if (!out.IsValid()) {
    return diplomat::Err<TemporalError>(TemporalError{
        ErrorKind::Range,
        "PlainDateTime out of range after combining date + time"});
  }
  return diplomat::Ok<std::unique_ptr<PlainDateTime>>(
      PlainDateTime::FromInfra(out));
}

}  // namespace temporal_rs

#endif  // TEMPORAL_RS_COMPAT_PLAINDATETIME_HPP_
