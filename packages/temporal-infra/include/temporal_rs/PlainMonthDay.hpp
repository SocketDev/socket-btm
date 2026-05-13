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
  // ISO path implemented inline; non-ISO calendars Err until backend.
  // Overflow='constrain' clamps month + day; 'reject' Errs.
  static diplomat::result<std::unique_ptr<PlainMonthDay>, TemporalError>
  try_new_with_overflow(uint8_t month, uint8_t day,
                        AnyCalendarKind calendar,
                        ArithmeticOverflow overflow,
                        std::optional<int32_t> ref_year) {
    // ISO arithmetic with the calendar kind threaded onto the POD;
    // calendar-aware accessors route through CalendarBackend at read.
    auto first_try =
        ::node::socketsecurity::temporal::PlainMonthDayTryNewIso(
            month, day, ref_year);
    if (first_try.ok()) {
      auto pmd = first_try.value();
      pmd.calendar = calendar.ToInfra();
      return diplomat::Ok<std::unique_ptr<PlainMonthDay>>(
          std::unique_ptr<PlainMonthDay>(new PlainMonthDay(pmd)));
    }
    if (overflow.ToInfra() !=
        ::node::socketsecurity::temporal::Overflow::kConstrain) {
      return diplomat::Err<TemporalError>(
          TemporalError::FromInfra(first_try.error()));
    }
    // Constrain: clamp month then day. Use ref_year (or 1972 — the
    // ISO leap-year reference) for the day clamp computation.
    const uint8_t clamped_month = month < 1 ? 1 : (month > 12 ? 12 : month);
    const int32_t year_for_days = ref_year.value_or(1972);
    const uint8_t max_day =
        ::node::socketsecurity::temporal::ISODaysInMonth(year_for_days,
                                                          clamped_month);
    const uint8_t clamped_day = day < 1 ? 1 : (day > max_day ? max_day : day);
    auto retry = ::node::socketsecurity::temporal::PlainMonthDayTryNewIso(
        clamped_month, clamped_day, ref_year);
    if (!retry.ok()) {
      return diplomat::Err<TemporalError>(
          TemporalError::FromInfra(retry.error()));
    }
    auto pmd = retry.value();
    pmd.calendar = calendar.ToInfra();
    return diplomat::Ok<std::unique_ptr<PlainMonthDay>>(
        std::unique_ptr<PlainMonthDay>(new PlainMonthDay(pmd)));
  }

  // 1:1 from upstream plain_month_day.rs:262 `with`. Empty partial is
  // a spec TypeError. ISO path: merge partial.month / partial.day onto
  // self, route through try_new_with_overflow with the carried-forward
  // calendar kind. month_code-only resolution requires the calendar
  // backend to map "M01"…"M12" to ordinal months; we keep that path
  // gated until the backend lands, but the common case (month + day
  // as plain integers) works today.
  diplomat::result<std::unique_ptr<PlainMonthDay>, TemporalError>
  with(PartialDate partial,
       std::optional<ArithmeticOverflow> overflow) const {
    if (!partial.month.has_value() && partial.month_code.empty() &&
        !partial.day.has_value() && !partial.year.has_value() &&
        partial.era.empty() && !partial.era_year.has_value()) {
      return diplomat::Err<TemporalError>(TemporalError{
          ErrorKind::Type, "PartialDate cannot be empty"});
    }
    // month_code-only resolution routes through CalendarResolveMonthCode
    // (ICU backend handles year-dependent leap variants).
    uint8_t merged_month = inner_.iso.month;
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
      ::node::socketsecurity::temporal::Calendar cal(inner_.calendar);
      auto r = ::node::socketsecurity::temporal::CalendarResolveMonthCode(
          cal, inner_.iso.year, code);
      if (!r.ok()) {
        return diplomat::Err<TemporalError>(
            TemporalError::FromInfra(r.error()));
      }
      merged_month = r.value();
    }
    const uint8_t merged_day = partial.day.value_or(inner_.iso.day);
    const ArithmeticOverflow ov =
        overflow.value_or(ArithmeticOverflow{});
    return try_new_with_overflow(
        merged_month, merged_day,
        AnyCalendarKind::FromInfra(inner_.calendar), ov,
        std::optional<int32_t>(inner_.iso.year));
  }

  // 1:1 from upstream plain_month_day.rs `to_plain_date`. ISO path:
  // pair the MonthDay's month+day with the caller-supplied year
  // override (PartialDate.year) or the MonthDay's reference_year.
  // Spec requires year to be provided when reference_year is the
  // default 1972; we accept either.
  diplomat::result<std::unique_ptr<PlainDate>, TemporalError>
  to_plain_date(std::optional<PartialDate> year) const {
    const int32_t resolved_year = (year.has_value() && year->year.has_value())
                                      ? *year->year
                                      : inner_.iso.year;
    auto result = ::node::socketsecurity::temporal::PlainDateTryNewIso(
        resolved_year, inner_.iso.month, inner_.iso.day);
    if (!result.ok()) {
      return diplomat::Err<TemporalError>(
          TemporalError::FromInfra(result.error()));
    }
    return diplomat::Ok<std::unique_ptr<PlainDate>>(
        PlainDate::FromInfra(result.value()));
  }

  diplomat::result<int64_t, TemporalError>
  epoch_ms_for_with_provider(TimeZone /*tz*/, const Provider& /*p*/) const {
    // Previously returned Ok(0) — silent wrong-answer: every
    // PlainMonthDay mapped to 1970-01-01T00:00:00Z. Match the
    // single-Provider overload below: return Err until calendar-aware
    // day projection + provider integration land.
    return diplomat::Err<TemporalError>(TemporalError{
        ErrorKind::Range,
        "PlainMonthDay.epochMsFor(timeZone, provider) requires a "
        "calendar backend + provider integration"});
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
  static diplomat::result<std::unique_ptr<PlainMonthDay>, TemporalError>
  from_parsed(const ParsedDate& parsed) {
    auto r = ::node::socketsecurity::temporal::PlainMonthDayTryNewIso(
        parsed.month(), parsed.day(), std::optional<int32_t>{});
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

  // Conversion: PlainMonthDay + year -> PlainDate. Templated so the
  // PlainDate.hpp / PlainMonthDay.hpp include cycle stays one-way.
  template <class PD>
  diplomat::result<std::unique_ptr<PD>, TemporalError> to_plain_date(
      const PD* /*reference_year_date*/) const {
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
  // ISO path: pass month + day directly with no reference_year
  // override. PlainMonthDayTryNewIso uses 1972 as the leap-year
  // anchor so Feb 29 round-trips cleanly.
  auto result = ::node::socketsecurity::temporal::PlainMonthDayTryNewIso(
      inner_.iso.month, inner_.iso.day, std::optional<int32_t>{});
  if (!result.ok()) {
    return diplomat::Err<TemporalError>(
        TemporalError::FromInfra(result.error()));
  }
  return diplomat::Ok<std::unique_ptr<PlainMonthDay>>(
      PlainMonthDay::FromInfra(result.value()));
}

}  // namespace temporal_rs

#endif  // TEMPORAL_RS_COMPAT_PLAINMONTHDAY_HPP_
