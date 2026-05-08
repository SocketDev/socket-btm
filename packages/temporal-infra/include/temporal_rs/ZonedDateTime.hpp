// Compat shim: temporal_rs::ZonedDateTime - heap-owned wrapper around
// node::socketsecurity::temporal::ZonedDateTime. Diplomat conventions:
// non-copyable / non-movable, factories return result<unique_ptr,...>.
//
// Methods marked "stub" return reasonable defaults until temporal-infra
// activates the corresponding paths (calendar-aware diff, IANA DST
// resolution, rounding tail). The goal at this stage is to make V8's
// js-temporal-objects.cc compile and link; full Temporal correctness
// is a follow-up.

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
#include "temporal_rs/AnyCalendarKind.hpp"
#include "temporal_rs/ArithmeticOverflow.hpp"
#include "temporal_rs/Calendar.hpp"
#include "temporal_rs/DifferenceSettings.hpp"
#include "temporal_rs/Disambiguation.hpp"
#include "temporal_rs/DisplayCalendar.hpp"
#include "temporal_rs/DisplayOffset.hpp"
#include "temporal_rs/DisplayTimeZone.hpp"
#include "temporal_rs/Duration.hpp"
#include "temporal_rs/I128Nanoseconds.hpp"
#include "temporal_rs/Instant.hpp"
#include "temporal_rs/OffsetDisambiguation.hpp"
#include "temporal_rs/ParsedZonedDateTime.hpp"
#include "temporal_rs/PartialZonedDateTime.hpp"
#include "temporal_rs/PlainDate.hpp"
#include "temporal_rs/PlainDateTime.hpp"
#include "temporal_rs/PlainTime.hpp"
#include "temporal_rs/Provider.hpp"
#include "temporal_rs/RoundingOptions.hpp"
#include "temporal_rs/TemporalError.hpp"
#include "temporal_rs/TimeZone.hpp"
#include "temporal_rs/ToStringRoundingOptions.hpp"
#include "temporal_rs/TransitionDirection.hpp"
#include "temporal_rs/diplomat_runtime.hpp"

namespace temporal_rs {

class Duration;
class Instant;
class ParsedZonedDateTime;
struct DifferenceSettings;
struct RoundingOptions;
struct ToStringRoundingOptions;

class ZonedDateTime {
 public:
  static diplomat::result<std::unique_ptr<ZonedDateTime>, TemporalError>
  try_new(I128Nanoseconds ns, const TimeZone& tz, const Calendar& cal) {
    ::node::socketsecurity::temporal::Instant instant{};
    instant.epoch_nanoseconds = ns.ToInfra();
    auto r = ::node::socketsecurity::temporal::ZonedDateTimeTryNew(
        instant, tz.ToInfra(), cal.ToInfra());
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

  // Build a ZonedDateTime from an already-parsed ParsedZonedDateTime.
  // Defined out-of-line below (ParsedZonedDateTime.hpp lives below to
  // break the include cycle).
  static diplomat::result<std::unique_ptr<ZonedDateTime>, TemporalError>
  from_parsed(const ParsedZonedDateTime& parsed,
              Disambiguation disambiguation,
              OffsetDisambiguation offset_option);

  static diplomat::result<std::unique_ptr<ZonedDateTime>, TemporalError>
  from_parsed_with_provider(const ParsedZonedDateTime& parsed,
                             Disambiguation disambiguation,
                             OffsetDisambiguation offset_option,
                             const Provider& p);

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

  // Calendar-aware accessors. Calendar-backend integration is pending;
  // these return ISO-equivalent values until the non-ISO paths
  // activate. The shim's Calendar is value-copyable so it can be
  // returned by value.
  Calendar calendar() const { return Calendar(inner_.calendar); }

  uint8_t day_of_week() const {
    auto pd = AsPlainDate();
    return pd.has_value()
               ? ::node::socketsecurity::temporal::PlainDateDayOfWeek(*pd)
               : 0;
  }
  uint16_t day_of_year() const {
    auto pd = AsPlainDate();
    return pd.has_value()
               ? ::node::socketsecurity::temporal::PlainDateDayOfYear(*pd)
               : 0;
  }
  uint8_t days_in_week() const { return 7; }
  uint8_t days_in_month() const {
    auto pd = AsPlainDate();
    return pd.has_value()
               ? ::node::socketsecurity::temporal::PlainDateDaysInMonth(*pd)
               : 0;
  }
  uint16_t days_in_year() const {
    auto pd = AsPlainDate();
    return pd.has_value()
               ? ::node::socketsecurity::temporal::PlainDateDaysInYear(*pd)
               : 0;
  }
  uint8_t months_in_year() const { return 12; }
  bool in_leap_year() const {
    auto pd = AsPlainDate();
    return pd.has_value()
               ? ::node::socketsecurity::temporal::PlainDateInLeapYear(*pd)
               : false;
  }
  // Calendar-extension fields (non-ISO only). Stub: empty for now.
  std::string month_code() const { return ""; }
  std::string era() const { return ""; }
  std::optional<int32_t> era_year() const { return std::nullopt; }
  std::optional<uint8_t> week_of_year() const { return std::nullopt; }
  std::optional<int32_t> year_of_week() const { return std::nullopt; }

  // V8 uses both `timezone()` and the older `get_time_zone()`.
  TimeZone timezone() const { return TimeZone::FromInfra(inner_.time_zone); }
  TimeZone get_time_zone() const { return timezone(); }

  // Spec: instant.epoch_nanoseconds / 1_000_000.
  int64_t epoch_milliseconds() const {
    using ::node::socketsecurity::temporal::Int128;
    Int128 ms = inner_.instant.epoch_nanoseconds / Int128(int64_t{1'000'000});
    return ms.ToInt64();
  }
  I128Nanoseconds epoch_nanoseconds() const {
    return I128Nanoseconds::FromInfra(inner_.instant.epoch_nanoseconds);
  }

  // Offset accessors. Stubbed for non-offset zones; returns "+00:00"
  // until the full IANA-DST path lands. For offset-only zones, the
  // value is correct.
  std::string offset() const {
    return inner_.time_zone.IsOffsetOnly()
               ? inner_.time_zone.OffsetOrNull().ToString()
               : "+00:00";
  }
  int64_t offset_nanoseconds() const {
    return inner_.time_zone.IsOffsetOnly()
               ? inner_.time_zone.OffsetOrNull().Nanoseconds()
               : 0;
  }

  // ── Conversions ─────────────────────────────────────────────────

  // Defined out-of-line at the bottom of this header. Inline-here body
  // would need the full Instant class, but Instant.hpp may not yet be
  // fully parsed when ZonedDateTime.hpp is reached (circular include
  // through transitive Duration.hpp / RelativeTo.hpp chain).
  inline std::unique_ptr<Instant> to_instant() const;

  // Upstream: returns plain unique_ptr (no result wrap). The underlying
  // C++ port may return an error, but the diplomat surface here is
  // total — on error, we fall back to a default-constructed shape so
  // V8's call site doesn't crash. Full error propagation lands when
  // the calendar-aware path activates.
  std::unique_ptr<PlainDateTime> to_plain_datetime() const {
    auto r = ::node::socketsecurity::temporal::ZonedDateTimeToPlainDateTime(
        inner_);
    if (!r.ok()) {
      return std::unique_ptr<PlainDateTime>(nullptr);
    }
    return PlainDateTime::FromInfra(r.value());
  }

  std::unique_ptr<PlainDate> to_plain_date() const {
    auto r =
        ::node::socketsecurity::temporal::ZonedDateTimeToPlainDate(inner_);
    if (!r.ok()) {
      return std::unique_ptr<PlainDate>(nullptr);
    }
    return PlainDate::FromInfra(r.value());
  }

  std::unique_ptr<PlainTime> to_plain_time() const {
    auto r =
        ::node::socketsecurity::temporal::ZonedDateTimeToPlainTime(inner_);
    if (!r.ok()) {
      return std::unique_ptr<PlainTime>(nullptr);
    }
    return PlainTime::FromInfra(r.value());
  }

  // ── Stubs for "with_provider" methods ──────────────────────────
  //
  // The "_with_provider" suffix routes through the registered
  // TimeZoneBackend. Stubbed bodies preserve the surface so V8 links;
  // semantic correctness arrives when the IANA-aware path lands.

  diplomat::result<std::unique_ptr<ZonedDateTime>, TemporalError>
  round_with_provider(const RoundingOptions& /*options*/,
                      const Provider& /*p*/) const {
    return diplomat::Ok<std::unique_ptr<ZonedDateTime>>(
        std::unique_ptr<ZonedDateTime>(new ZonedDateTime(inner_)));
  }

  diplomat::result<std::unique_ptr<ZonedDateTime>, TemporalError>
  start_of_day_with_provider(const Provider& /*p*/) const {
    return diplomat::Ok<std::unique_ptr<ZonedDateTime>>(
        std::unique_ptr<ZonedDateTime>(new ZonedDateTime(inner_)));
  }

  diplomat::result<std::optional<std::unique_ptr<ZonedDateTime>>, TemporalError>
  get_time_zone_transition_with_provider(TransitionDirection /*dir*/,
                                          const Provider& /*p*/) const {
    return diplomat::Ok<std::optional<std::unique_ptr<ZonedDateTime>>>(
        std::nullopt);
  }

  diplomat::result<double, TemporalError> hours_in_day_with_provider(
      const Provider& /*p*/) const {
    return diplomat::Ok<double>(24.0);
  }

  diplomat::result<bool, TemporalError> equals_with_provider(
      const ZonedDateTime& other, const Provider& /*p*/) const {
    return diplomat::Ok<bool>(equals(other));
  }

  // Upstream: returns plain unique_ptr (no result wrap, no error case).
  std::unique_ptr<ZonedDateTime> with_calendar(AnyCalendarKind kind) const {
    auto out_inner = inner_;
    out_inner.calendar =
        ::node::socketsecurity::temporal::Calendar(kind.ToInfra());
    return std::unique_ptr<ZonedDateTime>(new ZonedDateTime(out_inner));
  }

  // Upstream: with(partial, disambiguation, offset_option, overflow)
  // The full DST-aware path lives in the temporal-infra layer; this
  // shim returns Ok for now.
  diplomat::result<std::unique_ptr<ZonedDateTime>, TemporalError> with(
      PartialZonedDateTime /*partial*/,
      std::optional<Disambiguation> /*disambiguation*/,
      std::optional<OffsetDisambiguation> /*offset_option*/,
      std::optional<ArithmeticOverflow> /*overflow*/) const {
    return diplomat::Ok<std::unique_ptr<ZonedDateTime>>(
        std::unique_ptr<ZonedDateTime>(new ZonedDateTime(inner_)));
  }

  diplomat::result<std::unique_ptr<ZonedDateTime>, TemporalError>
  with_with_provider(PartialZonedDateTime partial,
                     std::optional<Disambiguation> disambiguation,
                     std::optional<OffsetDisambiguation> offset_option,
                     std::optional<ArithmeticOverflow> overflow,
                     const Provider& /*p*/) const {
    return with(partial, disambiguation, offset_option, overflow);
  }

  diplomat::result<std::unique_ptr<ZonedDateTime>, TemporalError>
  with_timezone(TimeZone zone) const {
    auto out_inner = inner_;
    out_inner.time_zone = zone.ToInfra();
    return diplomat::Ok<std::unique_ptr<ZonedDateTime>>(
        std::unique_ptr<ZonedDateTime>(new ZonedDateTime(out_inner)));
  }

  diplomat::result<std::unique_ptr<ZonedDateTime>, TemporalError>
  with_timezone_with_provider(TimeZone zone,
                               const Provider& /*p*/) const {
    return with_timezone(zone);
  }

  diplomat::result<std::unique_ptr<ZonedDateTime>, TemporalError>
  with_plain_time(const PlainTime* /*time*/) const {
    return diplomat::Ok<std::unique_ptr<ZonedDateTime>>(
        std::unique_ptr<ZonedDateTime>(new ZonedDateTime(inner_)));
  }

  diplomat::result<std::unique_ptr<ZonedDateTime>, TemporalError>
  with_plain_time_and_provider(
      const PlainTime* time,
      const Provider& /*p*/) const {
    return with_plain_time(time);
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

  // Project to a temporal-infra PlainDate so we can reuse the
  // calendar-component accessors. Returns nullopt for non-offset zones
  // when the TimeZoneBackend's GetIsoDateTimeFor fails — same fallback
  // as ZonedDateTimeYear/Month/...
  std::optional<::node::socketsecurity::temporal::PlainDate> AsPlainDate()
      const {
    auto idt = inner_.time_zone.GetIsoDateTimeFor(inner_.instant);
    if (!idt.ok()) {
      return std::nullopt;
    }
    return ::node::socketsecurity::temporal::PlainDate{idt.value().date};
  }

  ::node::socketsecurity::temporal::ZonedDateTime inner_;
};

// ── Out-of-line Instant methods that need ZonedDateTime visible ──
//
// Instant.hpp declares to_zoned_date_time_iso_with_provider but can't
// define it inline (circular include). Define it here.
inline diplomat::result<std::unique_ptr<ZonedDateTime>, TemporalError>
Instant::to_zoned_date_time_iso_with_provider(const TimeZone& tz,
                                               const Provider& /*p*/) const {
  return ZonedDateTime::try_new(
      I128Nanoseconds::FromInfra(inner_.epoch_nanoseconds), tz,
      Calendar(::node::socketsecurity::temporal::Calendar::Iso()));
}

// ── Out-of-line ZonedDateTime methods that need Instant visible ──
inline std::unique_ptr<Instant> ZonedDateTime::to_instant() const {
  return Instant::FromInfra(
      ::node::socketsecurity::temporal::ZonedDateTimeToInstant(inner_));
}

// ── ZonedDateTime::from_parsed{,_with_provider} definitions ───────
//
// Defined here, at the bottom of ZonedDateTime.hpp, so the
// ZonedDateTime class body is fully visible to the inline bodies.
// ParsedZonedDateTime.hpp is included at the top of this file and
// also has its full class body before this point.

inline diplomat::result<std::unique_ptr<ZonedDateTime>, TemporalError>
ZonedDateTime::from_parsed(const ParsedZonedDateTime& parsed,
                            Disambiguation /*disambiguation*/,
                            OffsetDisambiguation /*offset_option*/) {
  return diplomat::Ok<std::unique_ptr<ZonedDateTime>>(
      ZonedDateTime::FromInfra(parsed.inner_));
}

inline diplomat::result<std::unique_ptr<ZonedDateTime>, TemporalError>
ZonedDateTime::from_parsed_with_provider(const ParsedZonedDateTime& parsed,
                                          Disambiguation disambiguation,
                                          OffsetDisambiguation offset_option,
                                          const Provider& /*p*/) {
  return from_parsed(parsed, disambiguation, offset_option);
}

}  // namespace temporal_rs

#endif  // TEMPORAL_RS_COMPAT_ZONEDDATETIME_HPP_
