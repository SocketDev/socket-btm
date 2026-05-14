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

#include "socketsecurity/temporal/iso.h"
#include "socketsecurity/temporal/ixdtf_writer.h"
#include "socketsecurity/temporal/parse.h"
#include "socketsecurity/temporal/plain_date.h"
#include "socketsecurity/temporal/plain_date_time.h"
#include "temporal_rs/AnyCalendarKind.hpp"
#include "temporal_rs/ArithmeticOverflow.hpp"
#include "temporal_rs/Calendar.hpp"
#include "temporal_rs/DifferenceSettings.hpp"
#include "temporal_rs/DisplayCalendar.hpp"
#include "temporal_rs/Duration.hpp"
#include "temporal_rs/I128Nanoseconds.hpp"
#include "temporal_rs/ParsedDate.hpp"
#include "temporal_rs/PartialDate.hpp"
#include "temporal_rs/Provider.hpp"
#include "temporal_rs/TemporalError.hpp"
#include "temporal_rs/TimeZone.hpp"
#include "temporal_rs/diplomat_runtime.hpp"

namespace temporal_rs {

// Forward decls - full surface in their own headers (Phase 10c+).
class Duration;
class PlainDateTime;
class PlainMonthDay;
class PlainTime;
class PlainYearMonth;
class ZonedDateTime;
struct DifferenceSettings;
struct TimeZone;

class PlainDate {
 public:
  // ── Static factories ──────────────────────────────────────────────

  static diplomat::result<std::unique_ptr<PlainDate>, TemporalError> try_new(
      int32_t year, uint8_t month, uint8_t day, AnyCalendarKind calendar) {
    auto result =
        ::node::socketsecurity::temporal::PlainDateTryNewIso(year, month, day);
    if (!result.ok()) {
      return diplomat::Err<TemporalError>(
          TemporalError::FromInfra(result.error()));
    }
    auto pd = result.value();
    pd.calendar = calendar.ToInfra();
    return diplomat::Ok<std::unique_ptr<PlainDate>>(
        std::unique_ptr<PlainDate>(new PlainDate(pd)));
  }

  static diplomat::result<std::unique_ptr<PlainDate>, TemporalError>
  try_new_constrain(int32_t year, uint8_t month, uint8_t day,
                     AnyCalendarKind calendar) {
    auto result = ::node::socketsecurity::temporal::PlainDateNewWithOverflow(
        year, month, day,
        ::node::socketsecurity::temporal::Overflow::kConstrain);
    if (!result.ok()) {
      return diplomat::Err<TemporalError>(
          TemporalError::FromInfra(result.error()));
    }
    auto pd = result.value();
    pd.calendar = calendar.ToInfra();
    return diplomat::Ok<std::unique_ptr<PlainDate>>(
        std::unique_ptr<PlainDate>(new PlainDate(pd)));
  }

  static diplomat::result<std::unique_ptr<PlainDate>, TemporalError>
  try_new_with_overflow(int32_t year, uint8_t month, uint8_t day,
                         AnyCalendarKind calendar,
                         ArithmeticOverflow overflow) {
    const auto kind = calendar.ToInfra();
    if (kind == ::node::socketsecurity::temporal::CalendarKind::kIso) {
      auto result = ::node::socketsecurity::temporal::PlainDateNewWithOverflow(
          year, month, day, overflow.ToInfra());
      if (!result.ok()) {
        return diplomat::Err<TemporalError>(
            TemporalError::FromInfra(result.error()));
      }
      auto pd = result.value();
      pd.calendar = kind;
      return diplomat::Ok<std::unique_ptr<PlainDate>>(
          std::unique_ptr<PlainDate>(new PlainDate(pd)));
    }
    // Non-ISO: (year, month, day) are CALENDAR fields. Route through
    // IsoFromCalendarFields so the stored IsoDate is the real ISO
    // projection of the calendar date (Hebrew M05L was the prototype).
    auto iso_result =
        ::node::socketsecurity::temporal::GetCalendarBackend()
            .IsoFromCalendarFields(kind, year, month, day, overflow.ToInfra());
    if (!iso_result.ok()) {
      return diplomat::Err<TemporalError>(
          TemporalError::FromInfra(iso_result.error()));
    }
    ::node::socketsecurity::temporal::PlainDate pd{};
    pd.iso = iso_result.value();
    pd.calendar = kind;
    return diplomat::Ok<std::unique_ptr<PlainDate>>(
        std::unique_ptr<PlainDate>(new PlainDate(pd)));
  }

  static diplomat::result<std::unique_ptr<PlainDate>, TemporalError>
  from_partial(PartialDate partial,
                std::optional<ArithmeticOverflow> overflow) {
    std::optional<::node::socketsecurity::temporal::Overflow> infra_overflow;
    if (overflow.has_value()) {
      infra_overflow = overflow->ToInfra();
    }
    // Calendar-aware path: pass era / era_year / month_code through to
    // the infra layer alongside the bare ISO fields. The infra layer
    // dispatches by calendar.kind — ISO short-circuits to the legacy
    // ISO-only PlainDateFromPartial, non-ISO routes through the
    // CalendarBackend for era → year and month_code → ordinal_month
    // resolution before walking IsoFromCalendarFields.
    const auto ext = partial.ToInfraExtensions();
    auto result =
        ::node::socketsecurity::temporal::PlainDateFromPartialWithCalendar(
            partial.calendar.ToInfra(), partial.ToInfra(),
            ext.era, ext.has_era, ext.era_year, ext.has_era_year,
            ext.month_code, ext.has_month_code, infra_overflow);
    if (!result.ok()) {
      return diplomat::Err<TemporalError>(
          TemporalError::FromInfra(result.error()));
    }
    auto pd = result.value();
    // PlainDateFromPartialWithCalendar already sets pd.calendar; this
    // line is defensive for the (vanishingly rare) case where a
    // future change to the infra entry drops the calendar slot.
    pd.calendar = partial.calendar.ToInfra();
    return diplomat::Ok<std::unique_ptr<PlainDate>>(
        std::unique_ptr<PlainDate>(new PlainDate(pd)));
  }

  // from_utf8 parses IXDTF + may include a [u-ca=...] annotation;
  // PlainDateFromUtf8 already sets the calendar field if present.
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

  // Spec: build a PlainDate from an already-parsed ParsedDate. Routes
  // through the temporal-infra Try-iso path on the ISO components, then
  // overlays the parsed calendar kind so [u-ca=...] annotations survive
  // the FromParsed path (V8's PlainDate.from('YYYY-MM-DD[u-ca=hebrew]')
  // goes through ParsedDate::from_utf8 -> PlainDate::from_parsed, not
  // through PlainDate::from_utf8 directly).
  static diplomat::result<std::unique_ptr<PlainDate>, TemporalError>
  from_parsed(const ParsedDate& parsed) {
    auto r = ::node::socketsecurity::temporal::PlainDateTryNewIso(
        parsed.year(), parsed.month(), parsed.day());
    if (!r.ok()) {
      return diplomat::Err<TemporalError>(
          TemporalError::FromInfra(r.error()));
    }
    ::node::socketsecurity::temporal::PlainDate inner = r.value();
    inner.calendar =
        static_cast<::node::socketsecurity::temporal::CalendarKind>(
            parsed.ToInfra().calendar_kind);
    return diplomat::Ok<std::unique_ptr<PlainDate>>(
        std::unique_ptr<PlainDate>(new PlainDate(inner)));
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
  // Upstream: optional<uint8_t> — ISO weeks for non-Gregorian / partial
  // calendars may be undefined. We return the value unconditionally for
  // ISO-only callers; the optional is just the V8-expected wrap.
  std::optional<uint8_t> week_of_year() const {
    return std::optional<uint8_t>(
        ::node::socketsecurity::temporal::PlainDateWeekOfYear(inner_));
  }
  uint8_t days_in_month() const {
    ::node::socketsecurity::temporal::Calendar cal(inner_.calendar);
    return ::node::socketsecurity::temporal::CalendarDaysInMonth(cal,
                                                                   inner_.iso);
  }
  uint16_t days_in_year() const {
    ::node::socketsecurity::temporal::Calendar cal(inner_.calendar);
    return ::node::socketsecurity::temporal::CalendarDaysInYear(cal, inner_.iso);
  }
  bool in_leap_year() const {
    ::node::socketsecurity::temporal::Calendar cal(inner_.calendar);
    return ::node::socketsecurity::temporal::CalendarInLeapYear(cal, inner_.iso);
  }

  bool is_valid() const { return inner_.IsValid(); }

  // Calendar-aware accessors. Inner POD carries CalendarKind directly;
  // non-ISO answers route through the active CalendarBackend (which
  // V8's js-temporal binding installs as an ICU-backed override at
  // boot — see icu_cal_backend.h).
  Calendar calendar() const {
    return Calendar(::node::socketsecurity::temporal::Calendar(inner_.calendar));
  }
  uint8_t days_in_week() const {
    ::node::socketsecurity::temporal::Calendar cal(inner_.calendar);
    return ::node::socketsecurity::temporal::CalendarDaysInWeek(cal, inner_.iso);
  }
  uint8_t months_in_year() const {
    ::node::socketsecurity::temporal::Calendar cal(inner_.calendar);
    return ::node::socketsecurity::temporal::CalendarMonthsInYear(cal,
                                                                    inner_.iso);
  }
  std::string month_code() const {
    ::node::socketsecurity::temporal::Calendar cal(inner_.calendar);
    return ::node::socketsecurity::temporal::CalendarMonthCode(cal, inner_.iso);
  }
  std::string era() const {
    ::node::socketsecurity::temporal::Calendar cal(inner_.calendar);
    return ::node::socketsecurity::temporal::CalendarEra(cal, inner_.iso);
  }
  std::optional<int32_t> era_year() const {
    ::node::socketsecurity::temporal::Calendar cal(inner_.calendar);
    return ::node::socketsecurity::temporal::CalendarEraYear(cal, inner_.iso);
  }
  std::optional<int32_t> year_of_week() const {
    return std::optional<int32_t>(
        ::node::socketsecurity::temporal::ISOYearOfWeek(
            inner_.iso.year, inner_.iso.month, inner_.iso.day));
  }

  // 1:1 from upstream plain_date.rs `to_plain_date_time`. Pure ISO
  // merge — this.iso.date + (time ? time.iso : midnight). Body lives
  // at the tail of PlainDateTime.hpp because PlainTime and
  // PlainDateTime are both incomplete here (forward-declared only).
  diplomat::result<std::unique_ptr<PlainDateTime>, TemporalError>
  to_plain_date_time(const PlainTime* time) const;

  // 1:1 from upstream plain_date.rs:644.
  std::string to_ixdtf_string(DisplayCalendar display_calendar) const {
    return ::node::socketsecurity::temporal::IxdtfStringBuilder()
        .WithDate(inner_.iso)
        .WithCalendar("iso8601", display_calendar.ToInfra())
        .Build();
  }

  // 1:1 from upstream plain_date.rs `to_zoned_date_time`. Pairs
  // (this date + time-or-midnight) with the given TimeZone and
  // resolves to epoch-ns via the spec's default Disambiguation
  // (Compatible). Body lives at the tail of ZonedDateTime.hpp where
  // both the ZonedDateTime ctor surface and TimeZone::
  // GetEpochNanosecondsFor are complete.
  diplomat::result<std::unique_ptr<ZonedDateTime>, TemporalError>
  to_zoned_date_time(TimeZone tz, const PlainTime* time) const;

  diplomat::result<std::unique_ptr<ZonedDateTime>, TemporalError>
  to_zoned_date_time_with_provider(TimeZone tz,
                                    const PlainTime* time,
                                    const Provider& /*p*/) const {
    return to_zoned_date_time(tz, time);
  }

  // Upstream: returns plain unique_ptr (no result wrap, no error case).
  std::unique_ptr<PlainDate> with_calendar(AnyCalendarKind /*kind*/) const {
    // Calendar-aware projection lands with calendar.cc; for now,
    // return a clone (ISO-only path).
    return std::unique_ptr<PlainDate>(new PlainDate(inner_));
  }

  // 1:1 from upstream plain_date.rs `to_plain_month_day` /
  // `to_plain_year_month`. Bodies at the tail of PlainMonthDay.hpp /
  // PlainYearMonth.hpp respectively, because PlainMonthDay and
  // PlainYearMonth are forward-declared here (they include this
  // header, not the other way around).
  diplomat::result<std::unique_ptr<PlainMonthDay>, TemporalError>
  to_plain_month_day() const;

  diplomat::result<std::unique_ptr<PlainYearMonth>, TemporalError>
  to_plain_year_month() const;

  // ── Mutation (returns new heap-owned PlainDate) ───────────────────

  // Spec: Temporal.PlainDate.prototype.with — TC39 §3.3.23
  //   https://tc39.es/proposal-temporal/#sec-temporal.plaindate.prototype.with
  // Polyfill: js-temporal/temporal-polyfill/tree/rebase-part3/lib/plaindate.ts
  //
  // Spec algorithm:
  //   1. Let plainDate be the this value.
  //   2. Perform ? RequireInternalSlot.
  //   3. If ? IsPartialTemporalObject(temporalDateLike) is false, throw TypeError.
  //   4. Let calendar be plainDate.[[Calendar]].
  //   5. Let fields be ISODateToFields(calendar, plainDate.[[ISODate]], date).
  //   6. Let partialDate be ? PrepareCalendarFields(calendar, temporalDateLike,
  //                            « year, month, month-code, day », « », partial).
  //   7. Set fields to CalendarMergeFields(calendar, fields, partialDate).
  //   8. Let resolvedOptions be ? GetOptionsObject(options).
  //   9. Let overflow be ? GetTemporalOverflowOption(resolvedOptions).
  //  10. Let isoDate be ? CalendarDateFromFields(calendar, fields, overflow).
  //  11. Return ! CreateTemporalDate(isoDate, calendar).
  //
  // ISO path delegates to PlainDateWith (which performs the ISO equivalent
  // of steps 5/7/10 inline). Non-ISO path explicitly reads calendar-native
  // fields → merges → projects via the calendar backend.
  diplomat::result<std::unique_ptr<PlainDate>, TemporalError> with(
      PartialDate partial,
      std::optional<ArithmeticOverflow> overflow) const {
    // Spec step 4: calendar = self.[[Calendar]].
    const auto kind = inner_.calendar;
    // Spec steps 8 + 9: GetOptionsObject + GetTemporalOverflowOption.
    std::optional<::node::socketsecurity::temporal::Overflow> infra_overflow;
    if (overflow.has_value()) {
      infra_overflow = overflow->ToInfra();
    }
    if (kind == ::node::socketsecurity::temporal::CalendarKind::kIso) {
      // Spec steps 5 + 7 + 10 (ISO path): ISODateToFields collapses to
      // inner_.iso, CalendarMergeFields is a literal field merge,
      // CalendarDateFromFields → PlainDateNewWithOverflow. PlainDateWith
      // handles all three inline.
      auto result = ::node::socketsecurity::temporal::PlainDateWith(
          inner_, partial.ToInfra(), infra_overflow);
      if (!result.ok()) {
        return diplomat::Err<TemporalError>(
            TemporalError::FromInfra(result.error()));
      }
      auto pd = result.value();
      pd.calendar = kind;
      // Spec step 11: CreateTemporalDate.
      return diplomat::Ok<std::unique_ptr<PlainDate>>(
          std::unique_ptr<PlainDate>(new PlainDate(pd)));
    }
    // Spec step 3 (non-ISO): PartialDate POD-form of IsPartialTemporalObject
    // reject. V8 caller already validated the prototype-chain check; this
    // catches the empty-partial case.
    if (!partial.year.has_value() && !partial.month.has_value() &&
        partial.month_code.empty() && !partial.day.has_value() &&
        partial.era.empty() && !partial.era_year.has_value()) {
      return diplomat::Err<TemporalError>(TemporalError{
          ErrorKind::Type, "PartialDate cannot be empty"});
    }
    // Spec step 5 (non-ISO): ISODateToFields(calendar, isoDate, date) =
    // CalendarISOToDate; copy MonthCode + Year + Day.
    auto y = ::node::socketsecurity::temporal::GetCalendarBackend()
                  .Year(kind, inner_.iso);
    auto m = ::node::socketsecurity::temporal::GetCalendarBackend()
                  .Month(kind, inner_.iso);
    auto d = ::node::socketsecurity::temporal::GetCalendarBackend()
                  .Day(kind, inner_.iso);
    if (!y.ok() || !m.ok() || !d.ok()) {
      return diplomat::Err<TemporalError>(TemporalError{
          ErrorKind::Range,
          "Calendar backend unavailable for PlainDate.with"});
    }
    // Spec steps 6 + 7: PrepareCalendarFields(« year, month, monthCode, day »)
    // + CalendarMergeFields. CalendarFieldKeysToIgnore: month overrides
    // monthCode (and vice versa) — modeled via the if/else-if.
    const int32_t merged_year = partial.year.value_or(y.value());
    uint8_t merged_month = m.value();
    if (partial.month.has_value()) {
      merged_month = *partial.month;
    } else if (!partial.month_code.empty()) {
      if (partial.month_code.size() < 3 ||
          partial.month_code.size() > 4) {
        return diplomat::Err<TemporalError>(TemporalError{
            ErrorKind::Range, "Invalid monthCode length"});
      }
      ::node::socketsecurity::temporal::MonthCode code{};
      for (size_t i = 0; i < partial.month_code.size(); ++i) {
        code.bytes[i] = static_cast<uint8_t>(partial.month_code[i]);
      }
      ::node::socketsecurity::temporal::Calendar cal(kind);
      auto r = ::node::socketsecurity::temporal::CalendarResolveMonthCode(
          cal, merged_year, code);
      if (!r.ok()) {
        return diplomat::Err<TemporalError>(
            TemporalError::FromInfra(r.error()));
      }
      merged_month = r.value();
    }
    const uint8_t merged_day = partial.day.value_or(d.value());
    // Spec step 9 (non-ISO continuation): default overflow = ~constrain~.
    const ::node::socketsecurity::temporal::Overflow ov =
        infra_overflow.value_or(
            ::node::socketsecurity::temporal::Overflow::kConstrain);
    // Spec step 10: CalendarDateFromFields(calendar, mergedFields, overflow).
    // ICU4C backend collapses CalendarResolveFields + CalendarDateToISO +
    // ISODateWithinLimits into IsoFromCalendarFields.
    auto iso = ::node::socketsecurity::temporal::GetCalendarBackend()
                    .IsoFromCalendarFields(kind, merged_year, merged_month,
                                            merged_day, ov);
    if (!iso.ok()) {
      return diplomat::Err<TemporalError>(
          TemporalError::FromInfra(iso.error()));
    }
    // Spec step 11: CreateTemporalDate.
    ::node::socketsecurity::temporal::PlainDate pd{};
    pd.iso = iso.value();
    pd.calendar = kind;
    return diplomat::Ok<std::unique_ptr<PlainDate>>(
        std::unique_ptr<PlainDate>(new PlainDate(pd)));
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
