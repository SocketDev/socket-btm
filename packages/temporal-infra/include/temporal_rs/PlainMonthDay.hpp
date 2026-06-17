// Compat shim: temporal_rs::PlainMonthDay.

#ifndef TEMPORAL_RS_COMPAT_PLAINMONTHDAY_HPP_
#define TEMPORAL_RS_COMPAT_PLAINMONTHDAY_HPP_

#include <cstdint>
#include <memory>
#include <optional>
#include <string>
#include <string_view>

#include "socketsecurity/temporal/plain_date.h"
#include "socketsecurity/temporal/ixdtf_writer.h"
#include "socketsecurity/temporal/plain_month_day.h"
#include "temporal_rs/AnyCalendarKind.hpp"
#include "temporal_rs/ArithmeticOverflow.hpp"
#include "temporal_rs/Calendar.hpp"
#include "temporal_rs/DisplayCalendar.hpp"
#include "temporal_rs/ParsedDate.hpp"
#include "temporal_rs/PartialDate.hpp"
#include "temporal_rs/PlainDate.hpp"
#include "temporal_rs/Provider.hpp"
#include "temporal_rs/TemporalError.hpp"
#include "temporal_rs/diplomat_runtime.hpp"

namespace temporal_rs {

class PlainDate;

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

  // 1:1 from upstream plain_month_day.rs `from_partial`. ISO path:
  // requires partial.month + partial.day. partial.year (when present)
  // becomes the reference_year; otherwise defaults to 1972 (the
  // leap-year anchor) inside PlainMonthDayTryNewIso.
  // 1:1 from upstream plain_month_day.rs `from_partial`. ISO path
  // accepts month + day; non-ISO accepts monthCode + day (or month).
  // monthCode resolution routes through CalendarResolveMonthCode which
  // delegates to the ICU calendar backend for Hebrew/Chinese/Dangi
  // leap-month variants.
  static diplomat::result<std::unique_ptr<PlainMonthDay>, TemporalError>
  from_partial(PartialDate partial,
               std::optional<ArithmeticOverflow> overflow) {
    uint8_t resolved_month = 0;
    if (partial.month.has_value()) {
      resolved_month = *partial.month;
    } else if (!partial.month_code.empty()) {
      // Parse the monthCode string into a MonthCode POD.
      if (partial.month_code.size() < 3 ||
          partial.month_code.size() > 4) {
        return diplomat::Err<TemporalError>(TemporalError{
            ErrorKind::Range, "Invalid monthCode length"});
      }
      ::node::socketsecurity::temporal::MonthCode code{};
      for (size_t i = 0; i < partial.month_code.size(); ++i) {
        code.bytes[i] = static_cast<uint8_t>(partial.month_code[i]);
      }
      // Use the partial.year (or the ISO leap-year reference 1972)
      // for year-dependent leap resolution.
      const int32_t resolve_year = partial.year.value_or(1972);
      ::node::socketsecurity::temporal::Calendar cal(
          partial.calendar.ToInfra());
      auto r = ::node::socketsecurity::temporal::CalendarResolveMonthCode(
          cal, resolve_year, code);
      if (!r.ok()) {
        return diplomat::Err<TemporalError>(
            TemporalError::FromInfra(r.error()));
      }
      resolved_month = r.value();
    } else {
      return diplomat::Err<TemporalError>(TemporalError{
          ErrorKind::Range,
          "PlainMonthDay.from requires month or monthCode"});
    }
    if (!partial.day.has_value()) {
      return diplomat::Err<TemporalError>(TemporalError{
          ErrorKind::Range,
          "PlainMonthDay.from requires day"});
    }
    const ArithmeticOverflow ov =
        overflow.value_or(ArithmeticOverflow{});  // default kConstrain
    return try_new_with_overflow(resolved_month, *partial.day,
                                  partial.calendar, ov, partial.year);
  }

  // 1:1 from upstream plain_month_day.rs `try_new_with_overflow`.
  // ISO path: store inputs as-is (PMD's reference year is 1972 by
  // convention for ISO).
  // Non-ISO path: route (calendar_year, ordinal_month, day) through
  // CalendarBackend::IsoFromCalendarFields so the stored IsoDate is
  // the ACTUAL ISO projection of the calendar date — not the ISO
  // year-misread (Hebrew M05L was the prototype: ICU re-projects a
  // year stored as ISO into a different calendar month).
  static diplomat::result<std::unique_ptr<PlainMonthDay>, TemporalError>
  try_new_with_overflow(uint8_t month, uint8_t day,
                        AnyCalendarKind calendar,
                        ArithmeticOverflow overflow,
                        std::optional<int32_t> ref_year) {
    const auto kind = calendar.ToInfra();
    const bool is_iso = kind == ::node::socketsecurity::temporal::CalendarKind::kIso;
    if (is_iso) {
      // ISO path — unchanged. PMD's reference year is 1972; the day
      // clamp here uses the (potentially user-supplied) ref_year.
      auto first_try =
          ::node::socketsecurity::temporal::PlainMonthDayTryNewIso(
              month, day, ref_year);
      if (first_try.ok()) {
        auto pmd = first_try.value();
        pmd.calendar = kind;
        return diplomat::Ok<std::unique_ptr<PlainMonthDay>>(
            std::unique_ptr<PlainMonthDay>(new PlainMonthDay(pmd)));
      }
      if (overflow.ToInfra() !=
          ::node::socketsecurity::temporal::Overflow::kConstrain) {
        return diplomat::Err<TemporalError>(
            TemporalError::FromInfra(first_try.error()));
      }
      const uint8_t clamped_month =
          month < 1 ? 1 : (month > 12 ? 12 : month);
      const int32_t year_for_days = ref_year.value_or(1972);
      const uint8_t max_day =
          ::node::socketsecurity::temporal::ISODaysInMonth(year_for_days,
                                                            clamped_month);
      const uint8_t clamped_day =
          day < 1 ? 1 : (day > max_day ? max_day : day);
      auto retry =
          ::node::socketsecurity::temporal::PlainMonthDayTryNewIso(
              clamped_month, clamped_day, ref_year);
      if (!retry.ok()) {
        return diplomat::Err<TemporalError>(
            TemporalError::FromInfra(retry.error()));
      }
      auto pmd = retry.value();
      pmd.calendar = kind;
      return diplomat::Ok<std::unique_ptr<PlainMonthDay>>(
          std::unique_ptr<PlainMonthDay>(new PlainMonthDay(pmd)));
    }
    // Non-ISO: user-supplied (ref_year, month, day) are CALENDAR
    // fields. ref_year defaults to the spec's PMD reference year
    // (1972) — for non-ISO calendars there's no good default, but
    // ICU will project whatever is passed. Caller is expected to
    // pass a real year when they care (PartialDate.year).
    const int32_t calendar_year = ref_year.value_or(1972);
    auto iso_result =
        ::node::socketsecurity::temporal::GetCalendarBackend()
            .IsoFromCalendarFields(kind, calendar_year, month, day,
                                    overflow.ToInfra());
    if (!iso_result.ok()) {
      return diplomat::Err<TemporalError>(
          TemporalError::FromInfra(iso_result.error()));
    }
    ::node::socketsecurity::temporal::PlainMonthDay pmd{};
    pmd.iso = iso_result.value();
    pmd.calendar = kind;
    return diplomat::Ok<std::unique_ptr<PlainMonthDay>>(
        std::unique_ptr<PlainMonthDay>(new PlainMonthDay(pmd)));
  }

  // Spec: Temporal.PlainMonthDay.prototype.with — TC39 §10.3.6
  //   https://tc39.es/proposal-temporal/#sec-temporal.plainmonthday.prototype.with
  // Polyfill: js-temporal/temporal-polyfill/tree/rebase-part3/lib/plainmonthday.ts
  //
  // Spec algorithm:
  //   1. Let plainMonthDay be the this value.
  //   2. Perform ? RequireInternalSlot.
  //   3. If ? IsPartialTemporalObject(temporalMonthDayLike) is false, throw TypeError.
  //   4. Let calendar be plainMonthDay.[[Calendar]].
  //   5. Let fields be ISODateToFields(calendar, plainMonthDay.[[ISODate]], month-day).
  //   6. Let partialMonthDay be ? PrepareCalendarFields(calendar, temporalMonthDayLike,
  //                              « year, month, month-code, day », « », partial).
  //   7. Set fields to CalendarMergeFields(calendar, fields, partialMonthDay).
  //   8. Let resolvedOptions be ? GetOptionsObject(options).
  //   9. Let overflow be ? GetTemporalOverflowOption(resolvedOptions).
  //  10. Let isoDate be ? CalendarMonthDayFromFields(calendar, fields, overflow).
  //  11. Return ! CreateTemporalMonthDay(isoDate, calendar).
  //
  // For ISO PMD, ISODateToFields returns the stored ISO values verbatim,
  // so the merge collapses to direct field overrides on inner_.iso.
  diplomat::result<std::unique_ptr<PlainMonthDay>, TemporalError>
  with(PartialDate partial,
       std::optional<ArithmeticOverflow> overflow) const {
    // Spec step 3: PartialDate POD-form of IsPartialTemporalObject reject.
    // V8 caller already validated; this is the empty-partial guard.
    if (!partial.month.has_value() && partial.month_code.empty() &&
        !partial.day.has_value() && !partial.year.has_value() &&
        partial.era.empty() && !partial.era_year.has_value()) {
      return diplomat::Err<TemporalError>(TemporalError{
          ErrorKind::Type, "PartialDate cannot be empty"});
    }
    // Spec step 4: calendar = self.[[Calendar]].
    const auto kind = inner_.calendar;
    const bool is_iso =
        kind == ::node::socketsecurity::temporal::CalendarKind::kIso;
    // Spec step 5: ISODateToFields(calendar, isoDate, month-day).
    // ISODateToFields = empty + CalendarISOToDate(calendar, isoDate) →
    // copy MonthCode/Day always, Year only for ~date~/~year-month~. For
    // type=month-day spec doesn't read Year, but we keep it as ref_year
    // for the IsoFromCalendarFields back-projection (ICU needs a year).
    // For ISO PMD calendar-native == ISO, so skip the backend round-trip.
    int32_t self_year = inner_.iso.year;
    uint8_t self_month = inner_.iso.month;
    uint8_t self_day = inner_.iso.day;
    if (!is_iso) {
      auto y = ::node::socketsecurity::temporal::GetCalendarBackend()
                    .Year(kind, inner_.iso);
      auto m = ::node::socketsecurity::temporal::GetCalendarBackend()
                    .Month(kind, inner_.iso);
      auto d = ::node::socketsecurity::temporal::GetCalendarBackend()
                    .Day(kind, inner_.iso);
      if (!y.ok() || !m.ok() || !d.ok()) {
        return diplomat::Err<TemporalError>(TemporalError{
            ErrorKind::Range,
            "Calendar backend unavailable for PlainMonthDay.with"});
      }
      self_year = y.value();
      self_month = m.value();
      self_day = d.value();
    }
    // Spec steps 6 + 7: PrepareCalendarFields (« year, month, monthCode,
    // day », partial) + CalendarMergeFields(calendar, fields, partial).
    // CalendarMergeFields applies CalendarFieldKeysToIgnore: when the
    // overlay sets `month`, it overrides self's `monthCode` and vice
    // versa. We model that with the if/else-if below — partial.month
    // wins outright; partial.monthCode resolves via the backend.
    const int32_t merged_year = partial.year.value_or(self_year);
    uint8_t merged_month = self_month;
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
    const uint8_t merged_day = partial.day.value_or(self_day);
    // Spec steps 8 + 9: GetOptionsObject + GetTemporalOverflowOption.
    // V8 already unwrapped options into ArithmeticOverflow; default is
    // ~constrain~ via ArithmeticOverflow{} (CalendarMonthDayFromFields
    // defaults).
    const ArithmeticOverflow ov =
        overflow.value_or(ArithmeticOverflow{});
    // Spec steps 10 + 11: CalendarMonthDayFromFields + CreateTemporalMonthDay.
    // try_new_with_overflow non-ISO branch calls
    // backend.IsoFromCalendarFields, which is the ICU4C equivalent of
    // CalendarMonthDayToISOReferenceDate. (Spec also runs
    // CalendarResolveFields(month-day) before — we do this when
    // partial.monthCode resolution happened via CalendarResolveMonthCode
    // above; pure (month, day) input skips it.)
    return try_new_with_overflow(
        merged_month, merged_day,
        AnyCalendarKind::FromInfra(kind), ov,
        std::optional<int32_t>(merged_year));
  }

  // Spec: Temporal.PlainMonthDay.prototype.toPlainDate — TC39 §10.3.12
  //   https://tc39.es/proposal-temporal/#sec-temporal.plainmonthday.prototype.toplaindate
  // Polyfill: js-temporal/temporal-polyfill/tree/rebase-part3/lib/plainmonthday.ts
  //
  // Spec algorithm:
  //   1. Let plainMonthDay be the this value.
  //   2. Perform ? RequireInternalSlot.
  //   3. If item is not an Object, throw a TypeError exception.
  //   4. Let calendar be plainMonthDay.[[Calendar]].
  //   5. Let fields be ISODateToFields(calendar, plainMonthDay.[[ISODate]], month-day).
  //   6. Let inputFields be ? PrepareCalendarFields(calendar, item,
  //                            « year », « », « »).
  //   7. Let mergedFields be CalendarMergeFields(calendar, fields, inputFields).
  //   8. Let isoDate be ? CalendarDateFromFields(calendar, mergedFields, constrain).
  //   9. Return ! CreateTemporalDate(isoDate, calendar).
  //
  // For ISO PMD, ISODateToFields collapses to inner_.iso, so the merge
  // is just (resolved_year, iso.month, iso.day).
  diplomat::result<std::unique_ptr<PlainDate>, TemporalError>
  to_plain_date(std::optional<PartialDate> year) const {
    // Spec step 4: calendar = self.[[Calendar]].
    const auto kind = inner_.calendar;
    // Spec steps 6 + 7: PrepareCalendarFields(« year ») + CalendarMergeFields.
    // Only 'year' is in the input field set per spec — we read year off
    // the input override (or fall back to self's stored ISO year as ref
    // for the non-ISO IsoFromCalendarFields projection).
    const int32_t resolved_year =
        (year.has_value() && year->year.has_value()) ? *year->year
                                                      : inner_.iso.year;
    if (kind == ::node::socketsecurity::temporal::CalendarKind::kIso) {
      // Spec steps 8 + 9 (ISO path): CalendarDateFromFields collapses to
      // PlainDateTryNewIso when calendar=iso8601. Overflow defaults to
      // ~constrain~ per spec.
      auto result = ::node::socketsecurity::temporal::PlainDateTryNewIso(
          resolved_year, inner_.iso.month, inner_.iso.day);
      if (!result.ok()) {
        return diplomat::Err<TemporalError>(
            TemporalError::FromInfra(result.error()));
      }
      return diplomat::Ok<std::unique_ptr<PlainDate>>(
          PlainDate::FromInfra(result.value()));
    }
    // Spec step 5 (non-ISO): ISODateToFields(calendar, isoDate, month-day)
    // = CalendarISOToDate(calendar, isoDate), then copy MonthCode + Day.
    // We use ordinal Month instead of MonthCode here because
    // IsoFromCalendarFields takes ordinal months (CalendarResolveMonthCode
    // already ran on construction).
    auto cal_month = ::node::socketsecurity::temporal::GetCalendarBackend()
                          .Month(kind, inner_.iso);
    auto cal_day = ::node::socketsecurity::temporal::GetCalendarBackend()
                        .Day(kind, inner_.iso);
    if (!cal_month.ok() || !cal_day.ok()) {
      return diplomat::Err<TemporalError>(TemporalError{
          ErrorKind::Range,
          "Calendar backend unavailable for PlainMonthDay.toPlainDate"});
    }
    // Spec step 8: CalendarDateFromFields(calendar, mergedFields, constrain).
    // ICU4C backend collapses CalendarResolveFields + CalendarDateToISO +
    // ISODateWithinLimits into one call. Spec overflow=~constrain~ is
    // hardcoded per §10.3.12 step 8.
    auto iso = ::node::socketsecurity::temporal::GetCalendarBackend()
                    .IsoFromCalendarFields(
                        kind, resolved_year, cal_month.value(),
                        cal_day.value(),
                        ::node::socketsecurity::temporal::Overflow::kConstrain);
    if (!iso.ok()) {
      return diplomat::Err<TemporalError>(
          TemporalError::FromInfra(iso.error()));
    }
    // Spec step 9: CreateTemporalDate(isoDate, calendar).
    ::node::socketsecurity::temporal::PlainDate pd{};
    pd.iso = iso.value();
    pd.calendar = kind;
    return diplomat::Ok<std::unique_ptr<PlainDate>>(PlainDate::FromInfra(pd));
  }

  diplomat::result<int64_t, TemporalError>
  epoch_ms_for_with_provider(TimeZone tz, const Provider& /*p*/) const {
    // Combine (inner_.iso, noon) and resolve through the supplied
    // time zone. For ISO MonthDay, inner_.iso.year is the reference
    // year (1972) — the actual day value is stable.
    //
    // Mirrors the single-Provider overload below (which assumes UTC)
    // and the upstream plain_month_day.rs:380 algorithm. Provider arg
    // is unused: TimeZone carries its IANA id and the temporal-infra
    // backend dispatches directly through the V8 zoneinfo64 hook.
    ::node::socketsecurity::temporal::IsoDateTime iso{};
    iso.date = inner_.iso;
    iso.time.hour = 12;
    iso.time.minute = 0;
    iso.time.second = 0;
    iso.time.millisecond = 0;
    iso.time.microsecond = 0;
    iso.time.nanosecond = 0;
    auto ns = tz.ToInfra().GetEpochNanosecondsFor(
        iso, ::node::socketsecurity::temporal::Disambiguation::kCompatible);
    if (!ns.ok()) {
      return diplomat::Err<TemporalError>(
          TemporalError::FromInfra(ns.error()));
    }
    using NativeInt128 = decltype(ns.value().value);
    const NativeInt128 ns_per_ms{1'000'000};
    const NativeInt128 n = ns.value().value;
    NativeInt128 ms;
    if (n >= 0) {
      ms = n / ns_per_ms;
    } else {
      // Floor-division for negative: -1ms = -1_000_000ns, -1_000_001ns = -2ms.
      ms = (n - ns_per_ms + 1) / ns_per_ms;
    }
    return diplomat::Ok<int64_t>(static_cast<int64_t>(ms));
  }

  // 1:1 from upstream plain_month_day.rs:380 / :387.
  std::string to_ixdtf_string(DisplayCalendar display_calendar) const {
    ::node::socketsecurity::temporal::FormattableMonthDay fmd{
        ::node::socketsecurity::temporal::FormattableDate{
            inner_.iso.year, inner_.iso.month, inner_.iso.day},
        ::node::socketsecurity::temporal::FormattableCalendar{
            display_calendar.ToInfra(), "iso8601"}};
    return fmd.ToString();
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

  // Build a PlainMonthDay from a parsed record. Try-new ignores
  // calendar; overlay the parsed kind so [u-ca=...] survives.
  //
  // Reference-year handling mirrors upstream temporal_rs
  // /src/builtins/core/plain_month_day.rs `from_parsed`:
  //
  //   - ISO calendar:    hardcode 1972 (the spec's reference year —
  //                      first ISO 8601 leap year after the epoch).
  //                      Parsed year is ignored for ISO MonthDay since
  //                      toString omits the year and the only
  //                      consumer (equals) compares iso8601 month-day.
  //
  //   - Non-ISO calendar: pass parsed.year() through. The parser sets
  //                      year=1972 when the input was `--MM-DD` or
  //                      `MM-DD`, and the actual parsed year when the
  //                      input was `YYYY-MM-DD[u-ca=...]`. The
  //                      calendar-aware monthCode resolution downstream
  //                      depends on a specific reference year (e.g.
  //                      Hebrew M05L only exists in leap years), so
  //                      dropping it produces wrong monthCodes for
  //                      non-ISO calendars.
  static diplomat::result<std::unique_ptr<PlainMonthDay>, TemporalError>
  from_parsed(const ParsedDate& parsed) {
    // calendar_kind is a raw uint8_t in the parsed-intermediates POD
    // (0 = ISO); CalendarKind is `enum class … : uint8_t`, which has no
    // implicit conversion, so cast the enum to its underlying value to
    // compare.
    const bool is_iso =
        parsed.ToInfra().calendar_kind ==
        static_cast<uint8_t>(
            ::node::socketsecurity::temporal::CalendarKind::kIso);
    std::optional<int32_t> reference_year =
        is_iso ? std::optional<int32_t>{}
               : std::optional<int32_t>(parsed.year());
    auto r = ::node::socketsecurity::temporal::PlainMonthDayTryNewIso(
        parsed.month(), parsed.day(), reference_year);
    if (!r.ok()) {
      return diplomat::Err<TemporalError>(
          TemporalError::FromInfra(r.error()));
    }
    ::node::socketsecurity::temporal::PlainMonthDay inner = r.value();
    inner.calendar =
        static_cast<::node::socketsecurity::temporal::CalendarKind>(
            parsed.ToInfra().calendar_kind);
    return diplomat::Ok<std::unique_ptr<PlainMonthDay>>(
        std::unique_ptr<PlainMonthDay>(new PlainMonthDay(inner)));
  }

  uint8_t month() const {
    return ::node::socketsecurity::temporal::PlainMonthDayMonth(inner_);
  }
  uint8_t day() const {
    return ::node::socketsecurity::temporal::PlainMonthDayDay(inner_);
  }
  bool is_valid() const { return inner_.IsValid(); }

  // Calendar-aware accessors. Inner POD carries CalendarKind; non-ISO
  // answers route through the active CalendarBackend.
  Calendar calendar() const {
    return Calendar(
        ::node::socketsecurity::temporal::Calendar(inner_.calendar));
  }
  std::string month_code() const {
    ::node::socketsecurity::temporal::Calendar cal(inner_.calendar);
    return ::node::socketsecurity::temporal::CalendarMonthCode(cal, inner_.iso);
  }

  // Spec: Temporal.PlainMonthDay.prototype.toPlainDate — TC39 §10.3.12
  //   https://tc39.es/proposal-temporal/#sec-temporal.plainmonthday.prototype.toplaindate
  // Polyfill: js-temporal/temporal-polyfill/tree/rebase-part3/lib/plainmonthday.ts
  //
  // Templated overload — used internally where a reference_year PlainDate
  // is available. Diverges from the (item) overload in that it reads
  // calendar-native year from self instead of taking it from `item.year`.
  // The reference_year_date param is currently ignored (V8 wrapper
  // dispatches based on overload signature).
  //
  // Spec algorithm (steps 1-9, same as the non-templated overload):
  //   4. calendar = self.[[Calendar]].
  //   5. fields = ISODateToFields(calendar, self.[[ISODate]], month-day).
  //   6. inputFields = PrepareCalendarFields(calendar, item, « year »).
  //   7. mergedFields = CalendarMergeFields(calendar, fields, inputFields).
  //   8. isoDate = ? CalendarDateFromFields(calendar, mergedFields, constrain).
  //   9. Return CreateTemporalDate(isoDate, calendar).
  template <class PD>
  diplomat::result<std::unique_ptr<PD>, TemporalError> to_plain_date(
      const PD* /*reference_year_date*/) const {
    // Spec step 4: calendar.
    const auto kind = inner_.calendar;
    if (kind == ::node::socketsecurity::temporal::CalendarKind::kIso) {
      // Spec steps 5/7/8 (ISO path): CalendarISOToDate returns ISO fields
      // verbatim; CalendarDateFromFields → PlainDateTryNewIso.
      auto r = ::node::socketsecurity::temporal::PlainDateTryNewIso(
          inner_.iso.year, inner_.iso.month, inner_.iso.day);
      if (!r.ok()) {
        return diplomat::Err<TemporalError>(
            TemporalError::FromInfra(r.error()));
      }
      auto pd = r.value();
      pd.calendar = inner_.calendar;
      return diplomat::Ok<std::unique_ptr<PD>>(PD::FromInfra(pd));
    }
    // Spec step 5 (non-ISO): ISODateToFields → CalendarISOToDate.
    // The PMD's inner_.iso.year is the IsoFromCalendarFields-projected
    // ISO year (e.g. 2024 for Hebrew 5784); the calendar-native year is
    // what we need for the merge.
    auto cal_year = ::node::socketsecurity::temporal::GetCalendarBackend()
                        .Year(kind, inner_.iso);
    auto cal_month = ::node::socketsecurity::temporal::GetCalendarBackend()
                          .Month(kind, inner_.iso);
    auto cal_day = ::node::socketsecurity::temporal::GetCalendarBackend()
                        .Day(kind, inner_.iso);
    if (!cal_year.ok() || !cal_month.ok() || !cal_day.ok()) {
      return diplomat::Err<TemporalError>(TemporalError{
          ErrorKind::Range,
          "Calendar backend unavailable for PlainMonthDay.toPlainDate"});
    }
    // Spec step 8: CalendarDateFromFields(calendar, mergedFields, constrain).
    auto iso = ::node::socketsecurity::temporal::GetCalendarBackend()
                    .IsoFromCalendarFields(
                        kind, cal_year.value(), cal_month.value(),
                        cal_day.value(),
                        ::node::socketsecurity::temporal::Overflow::kConstrain);
    if (!iso.ok()) {
      return diplomat::Err<TemporalError>(
          TemporalError::FromInfra(iso.error()));
    }
    // Spec step 9: CreateTemporalDate.
    ::node::socketsecurity::temporal::PlainDate pd{};
    pd.iso = iso.value();
    pd.calendar = kind;
    return diplomat::Ok<std::unique_ptr<PD>>(PD::FromInfra(pd));
  }

  // 1:1 from upstream plain_month_day.rs:354 `epoch_ns_for_with_provider`.
  // Combines (iso.date, IsoTime::noon) at the MonthDay's reference year
  // and returns epoch ms in UTC.
  diplomat::result<int64_t, TemporalError> epoch_ms_for_with_provider(
      const Provider& /*p*/) const {
    ::node::socketsecurity::temporal::IsoDateTime iso{};
    iso.date = inner_.iso;
    iso.time.hour = 12;
    iso.time.minute = 0;
    iso.time.second = 0;
    iso.time.millisecond = 0;
    iso.time.microsecond = 0;
    iso.time.nanosecond = 0;
    auto utc = ::node::socketsecurity::temporal::TimeZone::Utc();
    auto ns = utc.GetEpochNanosecondsFor(
        iso, ::node::socketsecurity::temporal::Disambiguation::kCompatible);
    if (!ns.ok()) {
      return diplomat::Err<TemporalError>(
          TemporalError::FromInfra(ns.error()));
    }
    using NativeInt128 = decltype(ns.value().value);
    const NativeInt128 ns_per_ms{1'000'000};
    const NativeInt128 n = ns.value().value;
    NativeInt128 ms;
    if (n >= 0) {
      ms = n / ns_per_ms;
    } else {
      NativeInt128 q = n / ns_per_ms;
      NativeInt128 r = n % ns_per_ms;
      ms = (r == 0) ? q : q - 1;
    }
    return diplomat::Ok<int64_t>(static_cast<int64_t>(ms));
  }

  std::unique_ptr<PlainMonthDay> clone() const {
    return std::unique_ptr<PlainMonthDay>(new PlainMonthDay(inner_));
  }

  // ── Comparison ─────────────────────────────────────────────────

  bool equals(const PlainMonthDay& other) const {
    return inner_.iso.month == other.inner_.iso.month &&
           inner_.iso.day == other.inner_.iso.day;
  }

  static int8_t compare(const PlainMonthDay& one,
                         const PlainMonthDay& two) {
    if (one.inner_.iso.month != two.inner_.iso.month) {
      return one.inner_.iso.month < two.inner_.iso.month ? -1 : 1;
    }
    if (one.inner_.iso.day != two.inner_.iso.day) {
      return one.inner_.iso.day < two.inner_.iso.day ? -1 : 1;
    }
    return 0;
  }

  // ── Bridges ────────────────────────────────────────────────────

  const ::node::socketsecurity::temporal::PlainMonthDay& ToInfra() const {
    return inner_;
  }

  static std::unique_ptr<PlainMonthDay> FromInfra(
      const ::node::socketsecurity::temporal::PlainMonthDay& d) {
    return std::unique_ptr<PlainMonthDay>(new PlainMonthDay(d));
  }

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

// ── Cross-class out-of-line definitions ──────────────────────────────
// PlainDate::to_plain_month_day's body lives here because
// PlainMonthDay is forward-declared in PlainDate.hpp.

inline diplomat::result<std::unique_ptr<PlainMonthDay>, TemporalError>
PlainDate::to_plain_month_day() const {
  // Spec: Temporal.PlainDate.prototype.toPlainMonthDay — TC39 §3.3.20
  //   https://tc39.es/proposal-temporal/#sec-temporal.plaindate.prototype.toplainmonthday
  // Polyfill: js-temporal/temporal-polyfill/tree/rebase-part3/lib/plaindate.ts
  //
  // Spec algorithm:
  //   1. Let plainDate be the this value.
  //   2. Perform ? RequireInternalSlot.
  //   3. Let calendar be plainDate.[[Calendar]].
  //   4. Let fields be ISODateToFields(calendar, plainDate.[[ISODate]], date).
  //   5. Let isoDate be ? CalendarMonthDayFromFields(calendar, fields, constrain).
  //   6. Return ! CreateTemporalMonthDay(isoDate, calendar).
  //   NOTE: CalendarMonthDayFromFields is necessary to set [[Year]] of the
  //         [[ISODate]] correctly (sets the canonical reference year).
  //
  // For ISO PlainDate, calendar-native == ISO, and PMD's reference year
  // is the 1972 leap anchor — pass nullopt to PlainMonthDayTryNewIso.
  // Spec step 3: calendar = self.[[Calendar]].
  const auto kind = inner_.calendar;
  if (kind == ::node::socketsecurity::temporal::CalendarKind::kIso) {
    // Spec steps 4 + 5 (ISO): ISODateToFields collapses to inner_.iso,
    // CalendarMonthDayFromFields → PlainMonthDayTryNewIso (which picks
    // 1972 as reference year when nullopt is passed).
    auto result = ::node::socketsecurity::temporal::PlainMonthDayTryNewIso(
        inner_.iso.month, inner_.iso.day, std::optional<int32_t>{});
    if (!result.ok()) {
      return diplomat::Err<TemporalError>(
          TemporalError::FromInfra(result.error()));
    }
    auto pmd = result.value();
    pmd.calendar = kind;
    // Spec step 6.
    return diplomat::Ok<std::unique_ptr<PlainMonthDay>>(
        PlainMonthDay::FromInfra(pmd));
  }
  // Spec step 4 (non-ISO): ISODateToFields(calendar, isoDate, date) =
  // CalendarISOToDate(calendar, isoDate), copy MonthCode + Day + Year.
  auto cal_year = ::node::socketsecurity::temporal::GetCalendarBackend()
                      .Year(kind, inner_.iso);
  auto cal_month = ::node::socketsecurity::temporal::GetCalendarBackend()
                        .Month(kind, inner_.iso);
  auto cal_day = ::node::socketsecurity::temporal::GetCalendarBackend()
                      .Day(kind, inner_.iso);
  if (!cal_year.ok() || !cal_month.ok() || !cal_day.ok()) {
    return diplomat::Err<TemporalError>(TemporalError{
        ErrorKind::Range,
        "Calendar backend unavailable for PlainDate.toPlainMonthDay"});
  }
  // Spec step 5: CalendarMonthDayFromFields → CalendarResolveFields +
  // CalendarMonthDayToISOReferenceDate. ICU4C backend collapses these.
  // Known divergence: spec's CalendarMonthDayToISOReferenceDate searches
  // for the canonical reference year that makes (monthCode, day) valid;
  // we use cal_year directly. For non-leap dates equivalent; for leap
  // dates the reference year may differ (filed task #323).
  auto iso = ::node::socketsecurity::temporal::GetCalendarBackend()
                  .IsoFromCalendarFields(
                      kind, cal_year.value(), cal_month.value(),
                      cal_day.value(),
                      ::node::socketsecurity::temporal::Overflow::kConstrain);
  if (!iso.ok()) {
    return diplomat::Err<TemporalError>(
        TemporalError::FromInfra(iso.error()));
  }
  // Spec step 6: CreateTemporalMonthDay.
  ::node::socketsecurity::temporal::PlainMonthDay pmd{};
  pmd.iso = iso.value();
  pmd.calendar = kind;
  return diplomat::Ok<std::unique_ptr<PlainMonthDay>>(
      PlainMonthDay::FromInfra(pmd));
}

}  // namespace temporal_rs

#endif  // TEMPORAL_RS_COMPAT_PLAINMONTHDAY_HPP_
