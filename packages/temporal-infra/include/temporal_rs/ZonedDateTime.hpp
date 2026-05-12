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
#include <cstdlib>
#include <memory>
#include <optional>
#include <string>
#include <string_view>

#include "socketsecurity/temporal/error.h"
#include "socketsecurity/temporal/temporal.h"
#include "socketsecurity/temporal/ixdtf_writer.h"
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

  // 1:1 from upstream zoned_date_time.rs `from_partial_with_provider`.
  // ISO path: requires year + month + day in partial.date plus a tz
  // identifier; resolves the (date, time) wall clock to epoch-ns via
  // TimeZone::GetEpochNanosecondsFor with the requested
  // Disambiguation. OffsetDisambiguation only matters when the
  // partial also supplies an explicit offset — currently we ignore
  // it (the spec's `use` / `reject` semantics for offset matching
  // need the partial.offset field which the upstream parses out of
  // the tz string; for the V8 path this is rarely the entry point).
  static diplomat::result<std::unique_ptr<ZonedDateTime>, TemporalError>
  from_partial_with_provider(
      PartialZonedDateTime partial,
      std::optional<ArithmeticOverflow> /*overflow*/,
      std::optional<Disambiguation> disambiguation,
      std::optional<OffsetDisambiguation> /*offset_option*/,
      const Provider& /*p*/) {
    if (!partial.timezone.has_value()) {
      return diplomat::Err<TemporalError>(TemporalError{
          ErrorKind::Range,
          "ZonedDateTime.from(partial) requires a timeZone"});
    }
    if (!partial.date.year.has_value() || !partial.date.month.has_value() ||
        !partial.date.day.has_value()) {
      return diplomat::Err<TemporalError>(TemporalError{
          ErrorKind::Range,
          "ZonedDateTime.from(partial) requires year/month/day"});
    }
    ::node::socketsecurity::temporal::IsoDateTime iso{};
    iso.date.year = *partial.date.year;
    iso.date.month = *partial.date.month;
    iso.date.day = *partial.date.day;
    iso.time.hour = partial.time.hour.value_or(0);
    iso.time.minute = partial.time.minute.value_or(0);
    iso.time.second = partial.time.second.value_or(0);
    iso.time.millisecond = partial.time.millisecond.value_or(0);
    iso.time.microsecond = partial.time.microsecond.value_or(0);
    iso.time.nanosecond = partial.time.nanosecond.value_or(0);
    if (!iso.IsValid()) {
      return diplomat::Err<TemporalError>(TemporalError{
          ErrorKind::Range,
          "ZonedDateTime.from(partial) produced invalid IsoDateTime"});
    }
    const ::node::socketsecurity::temporal::Disambiguation d =
        disambiguation.has_value()
            ? disambiguation->ToInfra()
            : ::node::socketsecurity::temporal::Disambiguation::kCompatible;
    auto ns = partial.timezone->ToInfra().GetEpochNanosecondsFor(iso, d);
    if (!ns.ok()) {
      return diplomat::Err<TemporalError>(
          TemporalError::FromInfra(ns.error()));
    }
    ::node::socketsecurity::temporal::Instant instant{};
    instant.epoch_nanoseconds = ns.value();
    auto zr = ::node::socketsecurity::temporal::ZonedDateTimeTryNew(
        instant, partial.timezone->ToInfra(),
        ::node::socketsecurity::temporal::Calendar(
            partial.date.calendar.ToInfra()));
    if (!zr.ok()) {
      return diplomat::Err<TemporalError>(
          TemporalError::FromInfra(zr.error()));
    }
    return diplomat::Ok<std::unique_ptr<ZonedDateTime>>(
        ZonedDateTime::FromInfra(zr.value()));
  }

  // 1:1 from upstream zoned_date_time.rs `try_new_with_provider`. The
  // Provider is unused at construction (it would be needed if we
  // validated the wall-time against DST transitions, but try_new
  // takes raw epoch_ns + a time_zone identifier — no resolution
  // happens until the caller asks for wall-clock fields). Delegates
  // to the existing ZonedDateTimeTryNew helper.
  static diplomat::result<std::unique_ptr<ZonedDateTime>, TemporalError>
  try_new_with_provider(I128Nanoseconds nanosecond,
                        AnyCalendarKind calendar,
                        TimeZone time_zone,
                        const Provider& /*p*/) {
    ::node::socketsecurity::temporal::Instant instant{};
    instant.epoch_nanoseconds = nanosecond.ToInfra();
    if (!instant.IsValid()) {
      return diplomat::Err<TemporalError>(TemporalError{
          ErrorKind::Range, "Instant epoch nanoseconds out of range"});
    }
    auto r = ::node::socketsecurity::temporal::ZonedDateTimeTryNew(
        instant, time_zone.ToInfra(),
        ::node::socketsecurity::temporal::Calendar(calendar.ToInfra()));
    if (!r.ok()) {
      return diplomat::Err<TemporalError>(
          TemporalError::FromInfra(r.error()));
    }
    return diplomat::Ok<std::unique_ptr<ZonedDateTime>>(
        ZonedDateTime::FromInfra(r.value()));
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
  // Calendar-aware accessors. Route through the CalendarBackend so
  // non-ISO calendars (Hebrew, Japanese, ...) get the right answer.
  std::string month_code() const {
    auto pd = AsPlainDate();
    if (!pd.has_value()) {
      const uint8_t m = month();
      return std::string("M") + (m < 10 ? "0" : "") + std::to_string(m);
    }
    return ::node::socketsecurity::temporal::CalendarMonthCode(
        inner_.calendar, pd->iso);
  }
  std::string era() const {
    auto pd = AsPlainDate();
    return pd.has_value()
               ? ::node::socketsecurity::temporal::CalendarEra(inner_.calendar,
                                                                  pd->iso)
               : std::string{};
  }
  std::optional<int32_t> era_year() const {
    auto pd = AsPlainDate();
    return pd.has_value()
               ? ::node::socketsecurity::temporal::CalendarEraYear(
                     inner_.calendar, pd->iso)
               : std::nullopt;
  }
  std::optional<uint8_t> week_of_year() const {
    return std::optional<uint8_t>(
        ::node::socketsecurity::temporal::ISOWeekOfYear(year(), month(), day()));
  }
  std::optional<int32_t> year_of_week() const {
    return std::optional<int32_t>(
        ::node::socketsecurity::temporal::ISOYearOfWeek(year(), month(), day()));
  }

  // V8 uses both `timezone()` and the older `get_time_zone()`.
  TimeZone timezone() const { return TimeZone::FromInfra(inner_.time_zone); }
  TimeZone get_time_zone() const { return timezone(); }

  // Spec: floor(instant.epoch_nanoseconds / 1_000_000).
  int64_t epoch_milliseconds() const {
    using ::node::socketsecurity::temporal::Int128;
    // Floor div (not truncated div) to match spec — sub-ms negative
    // epoch nanoseconds round down, not toward zero.
    Int128 ms = inner_.instant.epoch_nanoseconds.FloorDiv(
        Int128(int64_t{1'000'000}));
    return ms.ToInt64();
  }
  I128Nanoseconds epoch_nanoseconds() const {
    return I128Nanoseconds::FromInfra(inner_.instant.epoch_nanoseconds);
  }

  // Offset accessors. Stubbed for non-offset zones; returns "+00:00"
  // until the full IANA-DST path lands. For offset-only zones, the
  // value is correct. Upstream returns `result<string, TemporalError>`.
  diplomat::result<std::string, TemporalError> offset() const {
    return diplomat::Ok<std::string>(
        inner_.time_zone.IsOffsetOnly()
            ? inner_.time_zone.OffsetOrNull().ToString()
            : std::string("+00:00"));
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
  // Upstream `to_plain_{date,time,date_time}` are infallible — a valid
  // ZonedDateTime always yields valid plain types. The underlying port
  // returns TemporalResult only because get_iso_datetime_for can fail
  // for malformed IANA zones; ZonedDateTime invariants reject those at
  // construction, so the error branch is unreachable in practice. If
  // it does fire, surface as the spec's expected RangeError via a
  // throwing unique_ptr — better than the silent-null V8 deref crash.
  // V8's binding consumes `unique_ptr<T>` directly (no result wrap) —
  // that matches upstream's diplomat surface so the V8 patch surface
  // stays minimal. The infra-side conversion can in principle fail
  // (e.g. malformed IANA zone), but ZonedDateTime's construction
  // invariants reject those upstream, so the error branch is genuinely
  // unreachable from valid ZDT inputs. If the branch ever fires we
  // abort rather than silently return a zero-valued PlainDate{} —
  // the latter was the original "silent garbage to V8" failure mode
  // that produced the @UZ-shaped error in the TemporalError bug.
  std::unique_ptr<PlainDateTime> to_plain_datetime() const {
    auto r = ::node::socketsecurity::temporal::ZonedDateTimeToPlainDateTime(
        inner_);
    if (!r.ok()) {
      std::abort();
    }
    return PlainDateTime::FromInfra(r.value());
  }

  std::unique_ptr<PlainDate> to_plain_date() const {
    auto r =
        ::node::socketsecurity::temporal::ZonedDateTimeToPlainDate(inner_);
    if (!r.ok()) {
      std::abort();
    }
    return PlainDate::FromInfra(r.value());
  }

  std::unique_ptr<PlainTime> to_plain_time() const {
    auto r =
        ::node::socketsecurity::temporal::ZonedDateTimeToPlainTime(inner_);
    if (!r.ok()) {
      std::abort();
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

  // 1:1 from upstream zoned_date_time.rs:846 `get_time_zone_transition`.
  // Routes through the registered TimeZoneBackend's GetTransition virtual
  // (IcuTimeZoneBackend uses BasicTimeZone::getNextTransition under the
  // hood). Offset-only timezones never have transitions and return
  // nullptr per spec (line 851).
  diplomat::result<std::unique_ptr<ZonedDateTime>, TemporalError>
  get_time_zone_transition_with_provider(TransitionDirection dir,
                                          const Provider& /*p*/) const {
    if (inner_.time_zone.IsOffsetOnly()) {
      return diplomat::Ok<std::unique_ptr<ZonedDateTime>>(nullptr);
    }
    auto& backend = ::node::socketsecurity::temporal::GetTimeZoneBackend();
    const auto direction =
        (dir == TransitionDirection::Next)
            ? ::node::socketsecurity::temporal::TimeZoneBackend::
                  TransitionDirection::kNext
            : ::node::socketsecurity::temporal::TimeZoneBackend::
                  TransitionDirection::kPrevious;
    auto result = backend.GetTransition(inner_.time_zone.Identifier(),
                                          inner_.instant.epoch_nanoseconds,
                                          direction);
    if (!result.ok()) {
      return diplomat::Err<TemporalError>(
          TemporalError::FromInfra(result.error()));
    }
    if (!result.value().has_value()) {
      return diplomat::Ok<std::unique_ptr<ZonedDateTime>>(nullptr);
    }
    ::node::socketsecurity::temporal::Instant inst{};
    inst.epoch_nanoseconds = *result.value();
    auto zr = ::node::socketsecurity::temporal::ZonedDateTimeTryNew(
        inst, inner_.time_zone, inner_.calendar);
    if (!zr.ok()) {
      return diplomat::Err<TemporalError>(
          TemporalError::FromInfra(zr.error()));
    }
    return diplomat::Ok<std::unique_ptr<ZonedDateTime>>(
        ZonedDateTime::FromInfra(zr.value()));
  }

  diplomat::result<double, TemporalError> hours_in_day_with_provider(
      const Provider& /*p*/) const {
    return diplomat::Ok<double>(24.0);
  }

  diplomat::result<bool, TemporalError> equals_with_provider(
      const ZonedDateTime& other, const Provider& /*p*/) const {
    return diplomat::Ok<bool>(equals(other));
  }

  // 1:1 from upstream zoned_date_time.rs:1375.
  diplomat::result<std::string, TemporalError>
  to_ixdtf_string_with_provider(DisplayOffset display_offset,
                                 DisplayTimeZone display_timezone,
                                 DisplayCalendar display_calendar,
                                 ToStringRoundingOptions options,
                                 const Provider& /*p*/) const {
    auto resolved =
        ::node::socketsecurity::temporal::ToStringRoundingOptionsResolve(
            options.ToInfra());
    if (!resolved.ok()) {
      return diplomat::Err<TemporalError>(
          TemporalError::FromInfra(resolved.error()));
    }
    // IANA-zone offset requires get_offset_nanos_for(provider). Until
    // the TimeZoneBackend hooks land we hard-fail rather than silently
    // emitting `+00:00` for every IANA zone.
    if (!inner_.time_zone.IsOffsetOnly()) {
      return diplomat::Err<TemporalError>(TemporalError{
          ErrorKind::Range,
          "ZonedDateTime.toString for IANA zones requires provider "
          "integration"});
    }
    // Upstream rounds the instant via round_instant BEFORE feeding
    // GetIsoDateTimeFor; same shape as Instant::to_ixdtf_string.
    if (resolved.value().smallest_unit !=
        ::node::socketsecurity::temporal::Unit::kNanosecond) {
      return diplomat::Err<TemporalError>(TemporalError{
          ErrorKind::Range,
          "ZonedDateTime.toString rounding to non-nanosecond units "
          "requires RoundInstant integration"});
    }
    auto datetime = inner_.time_zone.GetIsoDateTimeFor(inner_.instant);
    if (!datetime.ok()) {
      return diplomat::Err<TemporalError>(
          TemporalError::FromInfra(datetime.error()));
    }
    // Offset-only zone: the stored offset IS the resolved offset.
    const int64_t offset_ns = inner_.time_zone.OffsetOrNull().Nanoseconds();
    // H4: refuse sub-minute offsets. IXDTF's WithMinuteOffset truncates
    // seconds/nanoseconds silently; upstream's
    // nanoseconds_to_formattable_offset_minutes returns an error.
    constexpr int64_t kNsPerMinute = 60'000'000'000LL;
    if (offset_ns % kNsPerMinute != 0) {
      return diplomat::Err<TemporalError>(TemporalError{
          ErrorKind::Range,
          "ZonedDateTime.toString offset is not minute-aligned"});
    }
    const ::node::socketsecurity::temporal::Sign sign =
        offset_ns < 0
            ? ::node::socketsecurity::temporal::Sign::kNegative
            : ::node::socketsecurity::temporal::Sign::kPositive;
    const int64_t abs_ns = offset_ns < 0 ? -offset_ns : offset_ns;
    constexpr int64_t kNsPerDay = 24LL * 3600LL * 1'000'000'000LL;
    if (abs_ns >= kNsPerDay) {
      return diplomat::Err<TemporalError>(TemporalError{
          ErrorKind::Range,
          "ZonedDateTime.toString offset magnitude exceeds 24 hours"});
    }
    const uint8_t hour =
        static_cast<uint8_t>(abs_ns / 1'000'000'000LL / 3600);
    const uint8_t minute =
        static_cast<uint8_t>((abs_ns / 1'000'000'000LL / 60) % 60);
    const std::string tz_id = inner_.time_zone.Identifier();
    return diplomat::Ok<std::string>(
        ::node::socketsecurity::temporal::IxdtfStringBuilder()
            .WithDate(datetime.value().date)
            .WithTime(datetime.value().time, resolved.value().precision)
            .WithMinuteOffset(sign, hour, minute, display_offset.ToInfra())
            .WithTimeZone(tz_id, display_timezone.ToInfra())
            .WithCalendar("iso8601", display_calendar.ToInfra())
            .Build());
  }

  // Arithmetic (with-provider variants — DST-aware add/subtract land
  // with the calendar integration).
  diplomat::result<std::unique_ptr<ZonedDateTime>, TemporalError>
  add_with_provider(const Duration& /*duration*/,
                    std::optional<ArithmeticOverflow> /*overflow*/,
                    const Provider& /*p*/) const {
    return diplomat::Ok<std::unique_ptr<ZonedDateTime>>(
        std::unique_ptr<ZonedDateTime>(new ZonedDateTime(inner_)));
  }

  diplomat::result<std::unique_ptr<ZonedDateTime>, TemporalError>
  subtract_with_provider(const Duration& /*duration*/,
                         std::optional<ArithmeticOverflow> /*overflow*/,
                         const Provider& /*p*/) const {
    return diplomat::Ok<std::unique_ptr<ZonedDateTime>>(
        std::unique_ptr<ZonedDateTime>(new ZonedDateTime(inner_)));
  }

  // until/since on ZonedDateTime. For largestUnit ≤ Hour (the time-
  // only path), the answer is identical to Instant.until/since on the
  // inner instants — the TZ + Provider don't enter the calculation
  // because we're not crossing day boundaries. For largestUnit ∈
  // {Day, Week, Month, Year} the spec requires DST-aware calendar
  // carry via Provider, which isn't yet wired through time_zone.cc.
  diplomat::result<std::unique_ptr<Duration>, TemporalError>
  until_with_provider(const ZonedDateTime& other,
                       DifferenceSettings settings,
                       const Provider& /*p*/) const {
    return diff_via_instant(other, settings, /*negate=*/false);
  }

  diplomat::result<std::unique_ptr<Duration>, TemporalError>
  since_with_provider(const ZonedDateTime& other,
                       DifferenceSettings settings,
                       const Provider& /*p*/) const {
    return diff_via_instant(other, settings, /*negate=*/true);
  }

 private:
  // Body lives at the tail of Instant.hpp where both ZonedDateTime
  // and Instant are complete (this header has Instant only forward-
  // declared in some include orders).
  diplomat::result<std::unique_ptr<Duration>, TemporalError>
  diff_via_instant(const ZonedDateTime& other,
                   const DifferenceSettings& settings, bool negate) const;

 public:

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
    return ::node::socketsecurity::temporal::PlainDate{
        idt.value().date, inner_.calendar.Kind()};
  }

  ::node::socketsecurity::temporal::ZonedDateTime inner_;
};

// ── Out-of-line ZonedDateTime methods ───────────────────────────
//
// `ZonedDateTime::to_instant()` is defined in Instant.hpp's late
// section because its body calls `Instant::FromInfra` — `Instant` is
// only forward-declared at this point in the include cycle
// (Instant.hpp → Duration.hpp → RelativeTo.hpp → ZonedDateTime.hpp
// re-enters Instant.hpp before its class body has parsed). Defining
// here would compile against the forward decl and fail.

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

// Cross-class: PlainDate -> ZonedDateTime. Lives here because both
// PlainDateTime (intermediate, only its iso field used) and
// ZonedDateTime are complete.
inline diplomat::result<std::unique_ptr<ZonedDateTime>, TemporalError>
PlainDate::to_zoned_date_time(TimeZone tz, const PlainTime* time) const {
  ::node::socketsecurity::temporal::IsoDateTime iso{};
  iso.date = inner_.iso;
  if (time != nullptr) {
    iso.time = time->ToInfra().iso;
  }
  auto ns = tz.ToInfra().GetEpochNanosecondsFor(
      iso, ::node::socketsecurity::temporal::Disambiguation::kCompatible);
  if (!ns.ok()) {
    return diplomat::Err<TemporalError>(
        TemporalError::FromInfra(ns.error()));
  }
  ::node::socketsecurity::temporal::Instant instant{};
  instant.epoch_nanoseconds = ns.value();
  auto zr = ::node::socketsecurity::temporal::ZonedDateTimeTryNew(
      instant, tz.ToInfra(),
      ::node::socketsecurity::temporal::Calendar(inner_.calendar));
  if (!zr.ok()) {
    return diplomat::Err<TemporalError>(
        TemporalError::FromInfra(zr.error()));
  }
  return diplomat::Ok<std::unique_ptr<ZonedDateTime>>(
      ZonedDateTime::FromInfra(zr.value()));
}

// Cross-class: PlainDateTime::to_zoned_date_time body. Lives here so
// ZonedDateTime is complete at the use site. PlainDateTime.hpp only
// forward-declares ZonedDateTime in some include orders.
inline diplomat::result<std::unique_ptr<ZonedDateTime>, TemporalError>
PlainDateTime::to_zoned_date_time(TimeZone tz, Disambiguation disamb) const {
  auto ns = tz.ToInfra().GetEpochNanosecondsFor(inner_.iso, disamb.ToInfra());
  if (!ns.ok()) {
    return diplomat::Err<TemporalError>(
        TemporalError::FromInfra(ns.error()));
  }
  ::node::socketsecurity::temporal::Instant instant{};
  instant.epoch_nanoseconds = ns.value();
  auto zr = ::node::socketsecurity::temporal::ZonedDateTimeTryNew(
      instant, tz.ToInfra(),
      ::node::socketsecurity::temporal::Calendar(inner_.calendar));
  if (!zr.ok()) {
    return diplomat::Err<TemporalError>(
        TemporalError::FromInfra(zr.error()));
  }
  return diplomat::Ok<std::unique_ptr<ZonedDateTime>>(
      ZonedDateTime::FromInfra(zr.value()));
}

}  // namespace temporal_rs

#endif  // TEMPORAL_RS_COMPAT_ZONEDDATETIME_HPP_
