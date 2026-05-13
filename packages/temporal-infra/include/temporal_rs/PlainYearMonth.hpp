// Compat shim: temporal_rs::PlainYearMonth.

#ifndef TEMPORAL_RS_COMPAT_PLAINYEARMONTH_HPP_
#define TEMPORAL_RS_COMPAT_PLAINYEARMONTH_HPP_

#include <cmath>
#include <cstdint>
#include <memory>
#include <optional>
#include <string>
#include <string_view>

#include "socketsecurity/temporal/plain_date.h"
#include "socketsecurity/temporal/ixdtf_writer.h"
#include "socketsecurity/temporal/plain_year_month.h"
#include "socketsecurity/temporal/rounding.h"
#include "temporal_rs/AnyCalendarKind.hpp"
#include "temporal_rs/ArithmeticOverflow.hpp"
#include "temporal_rs/Calendar.hpp"
#include "temporal_rs/DifferenceSettings.hpp"
#include "temporal_rs/DisplayCalendar.hpp"
#include "temporal_rs/Duration.hpp"
#include "temporal_rs/ParsedDate.hpp"
#include "temporal_rs/PartialDate.hpp"
#include "temporal_rs/PlainDate.hpp"
#include "temporal_rs/Provider.hpp"
#include "temporal_rs/TemporalError.hpp"
#include "temporal_rs/diplomat_runtime.hpp"

namespace temporal_rs {

class PlainDate;

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

  // 1:1 from upstream plain_year_month.rs `from_partial`. ISO path:
  // requires partial.year + partial.month (no defaults per spec; the
  // ECMA-spec wraps this in ToTemporalYearMonth which validates).
  // For non-ISO calendars this still Errs.
  static diplomat::result<std::unique_ptr<PlainYearMonth>, TemporalError>
  from_partial(PartialDate partial,
               std::optional<ArithmeticOverflow> overflow) {
    // PartialDate has no calendar field — for the V8-facing entry,
    // ISO is the only path until the calendar backend lands.
    if (!partial.year.has_value()) {
      return diplomat::Err<TemporalError>(TemporalError{
          ErrorKind::Range,
          "PlainYearMonth.from requires year"});
    }
    uint8_t resolved_month = 0;
    if (partial.month.has_value()) {
      resolved_month = *partial.month;
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
      ::node::socketsecurity::temporal::Calendar cal(
          partial.calendar.ToInfra());
      auto r = ::node::socketsecurity::temporal::CalendarResolveMonthCode(
          cal, *partial.year, code);
      if (!r.ok()) {
        return diplomat::Err<TemporalError>(
            TemporalError::FromInfra(r.error()));
      }
      resolved_month = r.value();
    } else {
      return diplomat::Err<TemporalError>(TemporalError{
          ErrorKind::Range,
          "PlainYearMonth.from requires month or monthCode"});
    }
    const ArithmeticOverflow ov =
        overflow.value_or(ArithmeticOverflow{});  // default kConstrain
    return try_new_with_overflow(*partial.year, resolved_month,
                                  partial.day, partial.calendar, ov);
  }

  // 1:1 from upstream plain_year_month.rs `try_new_with_overflow`.
  // ISO path implemented inline; non-ISO calendars still Err until
  // the calendar backend lands. Overflow='constrain' clamps an
  // out-of-range reference_day to the month's max; 'reject' returns
  // Range.
  static diplomat::result<std::unique_ptr<PlainYearMonth>, TemporalError>
  try_new_with_overflow(int32_t year, uint8_t month,
                        std::optional<uint8_t> reference_day,
                        AnyCalendarKind calendar,
                        ArithmeticOverflow overflow) {
    // ISO calendar arithmetic still happens on the proleptic Gregorian
    // calendar here; non-ISO callers get the same ISO result with the
    // calendar kind stashed on the POD so accessors route through the
    // CalendarBackend at read time.
    auto first_try =
        ::node::socketsecurity::temporal::PlainYearMonthTryNewIso(
            year, month, reference_day);
    if (first_try.ok()) {
      auto pym = first_try.value();
      pym.calendar = calendar.ToInfra();
      return diplomat::Ok<std::unique_ptr<PlainYearMonth>>(
          std::unique_ptr<PlainYearMonth>(new PlainYearMonth(pym)));
    }
    if (overflow.ToInfra() !=
        ::node::socketsecurity::temporal::Overflow::kConstrain) {
      return diplomat::Err<TemporalError>(
          TemporalError::FromInfra(first_try.error()));
    }
    // Constrain: clamp month to [1, 12] then day to month's max.
    const uint8_t clamped_month = month < 1 ? 1 : (month > 12 ? 12 : month);
    const uint8_t max_day =
        ::node::socketsecurity::temporal::ISODaysInMonth(year, clamped_month);
    const uint8_t day = reference_day.value_or(1);
    const uint8_t clamped_day = day < 1 ? 1 : (day > max_day ? max_day : day);
    auto retry = ::node::socketsecurity::temporal::PlainYearMonthTryNewIso(
        year, clamped_month, clamped_day);
    if (!retry.ok()) {
      return diplomat::Err<TemporalError>(
          TemporalError::FromInfra(retry.error()));
    }
    auto pym = retry.value();
    pym.calendar = calendar.ToInfra();
    return diplomat::Ok<std::unique_ptr<PlainYearMonth>>(
        std::unique_ptr<PlainYearMonth>(new PlainYearMonth(pym)));
  }

  // 1:1 from upstream plain_year_month.rs `with`. ISO path: merge
  // partial.year / partial.month / partial.day onto self, re-validate
  // via try_new_with_overflow. month_code resolution falls back to
  // calendar backend.
  diplomat::result<std::unique_ptr<PlainYearMonth>, TemporalError>
  with(PartialDate partial,
       std::optional<ArithmeticOverflow> overflow) const {
    const int32_t merged_year = partial.year.value_or(inner_.iso.year);
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
          cal, merged_year, code);
      if (!r.ok()) {
        return diplomat::Err<TemporalError>(
            TemporalError::FromInfra(r.error()));
      }
      merged_month = r.value();
    }
    const std::optional<uint8_t> merged_day =
        partial.day.has_value() ? partial.day
                                : std::optional<uint8_t>(inner_.iso.day);
    const ArithmeticOverflow ov =
        overflow.value_or(ArithmeticOverflow{});
    return try_new_with_overflow(
        merged_year, merged_month, merged_day,
        AnyCalendarKind::FromInfra(inner_.calendar), ov);
  }

  diplomat::result<std::unique_ptr<PlainYearMonth>, TemporalError>
  add(const Duration& duration, ArithmeticOverflow overflow) const {
    return add_or_subtract(duration, overflow, /*negate=*/false);
  }

  diplomat::result<std::unique_ptr<PlainYearMonth>, TemporalError>
  subtract(const Duration& duration, ArithmeticOverflow overflow) const {
    return add_or_subtract(duration, overflow, /*negate=*/true);
  }

 private:
  // ISO-only year-month arithmetic. PlainYearMonth.add/subtract apply
  // only years/months from the duration (weeks/days/hours/etc are
  // disallowed per spec). The day component stays at the original
  // `reference_day` (preserved on the inner); when the resulting
  // year-month has fewer days (e.g. Jan 31 + 1M → Feb), the spec
  // default (overflow='constrain') clamps the day to the new month's
  // length; overflow='reject' returns Range.
  diplomat::result<std::unique_ptr<PlainYearMonth>, TemporalError>
  add_or_subtract(const Duration& duration, ArithmeticOverflow overflow,
                  bool negate) const {
    // Reject non-finite duration fields before any double→int cast —
    // `static_cast<int64_t>(NaN/Inf)` is UB per [conv.fpint]/4. The
    // V8 caller normally validates via Duration::TryNew, but this is
    // a `noexcept` boundary; belt-and-suspenders. Field accessors on
    // the compat Duration are zero-arg getters (`years()` etc.).
    const double dy = duration.years();
    const double dM = duration.months();
    if (std::isnan(dy) || std::isinf(dy) || std::isnan(dM) || std::isinf(dM)) {
      return diplomat::Err<TemporalError>(TemporalError{
          ErrorKind::Range, "Duration year/month component is not finite"});
    }
    if (duration.weeks() != 0 || duration.days() != 0 ||
        duration.hours() != 0 || duration.minutes() != 0 ||
        duration.seconds() != 0 || duration.milliseconds() != 0 ||
        duration.microseconds() != 0 || duration.nanoseconds() != 0) {
      return diplomat::Err<TemporalError>(TemporalError{
          ErrorKind::Range,
          "PlainYearMonth arithmetic only accepts year + month durations"});
    }
    const double sign = negate ? -1.0 : 1.0;
    const int64_t add_years = static_cast<int64_t>(dy * sign);
    const int64_t add_months = static_cast<int64_t>(dM * sign);

    int64_t total_months =
        static_cast<int64_t>(inner_.iso.year) * 12 +
        static_cast<int64_t>(inner_.iso.month - 1) +
        add_years * 12 + add_months;
    // Floor-divide by 12 without UB at INT64_MIN. `-((-x + 11)/12)` is
    // UB if `x == INT64_MIN` because `-x` overflows; `(x - 11) / 12`
    // computes floor(x/12) for negative x without the negation step.
    const int64_t new_year = total_months >= 0
                                 ? total_months / 12
                                 : (total_months - 11) / 12;
    const int64_t new_month_zero = total_months - new_year * 12;
    if (new_year < -271820 || new_year > 275759) {
      return diplomat::Err<TemporalError>(TemporalError{
          ErrorKind::Range,
          "PlainYearMonth.add result outside representable range"});
    }
    const int32_t year_i32 = static_cast<int32_t>(new_year);
    const uint8_t month_u8 = static_cast<uint8_t>(new_month_zero + 1);
    auto first_try =
        ::node::socketsecurity::temporal::PlainYearMonthTryNewIso(
            year_i32, month_u8, inner_.iso.day);
    if (first_try.ok()) {
      return diplomat::Ok<std::unique_ptr<PlainYearMonth>>(
          std::unique_ptr<PlainYearMonth>(new PlainYearMonth(first_try.value())));
    }
    if (overflow.ToInfra() !=
        ::node::socketsecurity::temporal::Overflow::kConstrain) {
      return diplomat::Err<TemporalError>(
          TemporalError::FromInfra(first_try.error()));
    }
    // Spec default (overflow='constrain'): clamp the reference day to
    // the new month's max. `Jan 31 + 1M` → `Feb 28/29` per
    // RegulateISOYearMonth.
    const uint8_t clamped =
        ::node::socketsecurity::temporal::ISODaysInMonth(year_i32, month_u8);
    auto retry = ::node::socketsecurity::temporal::PlainYearMonthTryNewIso(
        year_i32, month_u8, clamped);
    if (!retry.ok()) {
      return diplomat::Err<TemporalError>(
          TemporalError::FromInfra(retry.error()));
    }
    return diplomat::Ok<std::unique_ptr<PlainYearMonth>>(
        std::unique_ptr<PlainYearMonth>(new PlainYearMonth(retry.value())));
  }

 public:

  // 1:1 from upstream plain_year_month.rs:240-330 `diff`. Spec
  // disallows `week`/`day` as largest/smallest_unit for YearMonth
  // differences; everything else routes through CalendarDateUntil
  // on day-1-normalized dates so the ICU-backed CalendarBackend
  // services non-ISO calendars. Rounding tail (smallest != month
  // or increment != 1) routes through IncrementRounder<int64_t>
  // on the months-delta; upstream's `round_relative_duration`
  // collapses to this case for YearMonth because there's no time
  // or day component.
  diplomat::result<std::unique_ptr<Duration>, TemporalError>
  until(const PlainYearMonth& other, DifferenceSettings settings) const {
    return diff_year_month(other, settings, /*negate=*/false);
  }

  diplomat::result<std::unique_ptr<Duration>, TemporalError>
  since(const PlainYearMonth& other, DifferenceSettings settings) const {
    return diff_year_month(other, settings, /*negate=*/true);
  }

 private:
  diplomat::result<std::unique_ptr<Duration>, TemporalError>
  diff_year_month(const PlainYearMonth& other, DifferenceSettings settings,
                  bool negate) const {
    // Spec: calendar-mismatch is a hard RangeError. ToInfra here
    // because the inner CalendarKind is uint8_t — equality only.
    if (inner_.calendar != other.inner_.calendar) {
      return diplomat::Err<TemporalError>(TemporalError{
          ErrorKind::Range,
          "Calendars for difference operation are not the same."});
    }
    // Spec disallows week/day units in YearMonth differences.
    if (settings.largest_unit.has_value()) {
      const auto u = *settings.largest_unit;
      if (u == Unit::Week || u == Unit::Day) {
        return diplomat::Err<TemporalError>(TemporalError{
            ErrorKind::Range,
            "Weeks and days are not allowed in this operation."});
      }
    }
    if (settings.smallest_unit.has_value()) {
      const auto u = *settings.smallest_unit;
      if (u == Unit::Week || u == Unit::Day) {
        return diplomat::Err<TemporalError>(TemporalError{
            ErrorKind::Range,
            "Weeks and days are not allowed in this operation."});
      }
    }
    // Equal ISO date → zero duration (spec: line 273-276).
    if (inner_.iso.year == other.inner_.iso.year &&
        inner_.iso.month == other.inner_.iso.month) {
      return diplomat::Ok<std::unique_ptr<Duration>>(
          Duration::FromInfra(::node::socketsecurity::temporal::Duration{}));
    }
    // Spec: ISODateToFields with day=1 on both sides, then
    // CalendarDateUntil with largestUnit. Defaults to Year for
    // YearMonth differences (matches upstream).
    const ::node::socketsecurity::temporal::IsoDate this_iso{
        inner_.iso.year, inner_.iso.month, 1};
    const ::node::socketsecurity::temporal::IsoDate other_iso{
        other.inner_.iso.year, other.inner_.iso.month, 1};
    const ::node::socketsecurity::temporal::Unit largest =
        settings.largest_unit.has_value()
            ? settings.largest_unit->ToInfra()
            : ::node::socketsecurity::temporal::Unit::kYear;
    ::node::socketsecurity::temporal::Calendar cal(inner_.calendar);
    auto diff = ::node::socketsecurity::temporal::CalendarDateUntil(
        cal, this_iso, other_iso, largest);
    if (!diff.ok()) {
      return diplomat::Err<TemporalError>(
          TemporalError::FromInfra(diff.error()));
    }
    // YearMonth differences zero out weeks + days per upstream
    // `result.date().adjust(0, Some(0), None)` (line 301).
    auto d = diff.value();
    d.weeks = 0;
    d.days = 0;

    // Rounding tail. Upstream gates on `smallest != Month ||
    // increment != 1` (line 307). Spec's RoundRelativeDuration for
    // YearMonth collapses to a months-delta rounding since the
    // duration has only year + month components.
    const ::node::socketsecurity::temporal::Unit smallest =
        settings.smallest_unit.has_value()
            ? settings.smallest_unit->ToInfra()
            : ::node::socketsecurity::temporal::Unit::kMonth;
    const uint32_t increment = settings.increment.value_or(1u);
    const ::node::socketsecurity::temporal::RoundingMode mode =
        settings.rounding_mode.has_value()
            ? settings.rounding_mode->ToInfra()
            : ::node::socketsecurity::temporal::RoundingMode::kTrunc;
    if (smallest != ::node::socketsecurity::temporal::Unit::kMonth ||
        increment != 1u) {
      // Total months in d (years*12 + months). Both are doubles in the
      // POD; for diff results they're integral and well within int64.
      int64_t total_months = static_cast<int64_t>(d.years) * 12 +
                              static_cast<int64_t>(d.months);
      // Per spec: `since` negates the rounding mode (already applied
      // upstream for `until`; for `since` we'll negate the final
      // result, so apply the mode-negate here to mirror upstream's
      // ResolvedRoundingOptions::from_diff_settings + since flip).
      const ::node::socketsecurity::temporal::RoundingMode effective_mode =
          negate
              ? ::node::socketsecurity::temporal::RoundingModeNegate(mode)
              : mode;
      if (smallest == ::node::socketsecurity::temporal::Unit::kYear) {
        // Round to multiples of (12 * increment) months.
        const uint64_t step = 12ULL * static_cast<uint64_t>(increment);
        auto r = ::node::socketsecurity::temporal::IncrementRounder<int64_t>
                     ::FromSignedNum(total_months, step);
        if (!r.ok()) {
          return diplomat::Err<TemporalError>(
              TemporalError::FromInfra(r.error()));
        }
        const int64_t rounded_months = r.value().Round(effective_mode);
        d.years = static_cast<double>(rounded_months / 12);
        d.months = static_cast<double>(rounded_months -
                                         (rounded_months / 12) * 12);
      } else {
        // smallest == Month, increment != 1. Round months-delta to
        // multiples of increment, preserving the years carry.
        auto r = ::node::socketsecurity::temporal::IncrementRounder<int64_t>
                     ::FromSignedNum(total_months,
                                     static_cast<uint64_t>(increment));
        if (!r.ok()) {
          return diplomat::Err<TemporalError>(
              TemporalError::FromInfra(r.error()));
        }
        const int64_t rounded_months = r.value().Round(effective_mode);
        // Re-balance the rounded result back into years + months
        // matching largestUnit's expectation. If largestUnit is Year
        // the months may carry to years; if Month, keep as months.
        if (largest == ::node::socketsecurity::temporal::Unit::kYear) {
          d.years = static_cast<double>(rounded_months / 12);
          d.months = static_cast<double>(rounded_months -
                                           (rounded_months / 12) * 12);
        } else {
          d.years = 0;
          d.months = static_cast<double>(rounded_months);
        }
      }
    }

    if (negate) {
      d = ::node::socketsecurity::temporal::DurationNegated(d);
    }
    return diplomat::Ok<std::unique_ptr<Duration>>(Duration::FromInfra(d));
  }

 public:

  // 1:1 from upstream plain_year_month.rs `to_plain_date`. ISO path:
  // pair the YearMonth's year+month with a caller-supplied day (via
  // the PartialDate.day override) or the YearMonth's reference_day.
  // Spec requires day to be valid for the (year, month) combination —
  // we delegate to PlainDateTryNewIso which calls IsoDate::IsValid
  // (which now enforces per-month days post-C6).
  diplomat::result<std::unique_ptr<PlainDate>, TemporalError>
  to_plain_date(std::optional<PartialDate> day) const {
    const uint8_t resolved_day = (day.has_value() && day->day.has_value())
                                     ? *day->day
                                     : inner_.iso.day;
    auto result = ::node::socketsecurity::temporal::PlainDateTryNewIso(
        inner_.iso.year, inner_.iso.month, resolved_day);
    if (!result.ok()) {
      return diplomat::Err<TemporalError>(
          TemporalError::FromInfra(result.error()));
    }
    return diplomat::Ok<std::unique_ptr<PlainDate>>(
        PlainDate::FromInfra(result.value()));
  }

  // 1:1 from upstream plain_year_month.rs:602 `epoch_ns_for_with_provider`.
  // Combines (iso.date, IsoTime::noon) and routes through
  // TimeZone::GetEpochNanosecondsFor with Disambiguation::Compatible.
  // Returns epoch *milliseconds* per V8's API; internal conversion
  // divides epoch_ns by 1_000_000.
  diplomat::result<int64_t, TemporalError>
  epoch_ms_for_with_provider(TimeZone tz, const Provider& /*p*/) const {
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
    // Floor-divide int128 ns by 1e6 to get ms. Spec: epochMilliseconds
    // floors toward -infinity, not toward zero.
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

  // 1:1 from upstream plain_year_month.rs:630 / :638.
  std::string to_ixdtf_string(DisplayCalendar display_calendar) const {
    ::node::socketsecurity::temporal::FormattableYearMonth fym{
        ::node::socketsecurity::temporal::FormattableDate{
            inner_.iso.year, inner_.iso.month, inner_.iso.day},
        ::node::socketsecurity::temporal::FormattableCalendar{
            display_calendar.ToInfra(), "iso8601"}};
    return fym.ToString();
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

  // Build a PlainYearMonth from a parsed-and-validated record. Try-new
  // ignores calendar; overlay the parsed kind so [u-ca=...] survives.
  static diplomat::result<std::unique_ptr<PlainYearMonth>, TemporalError>
  from_parsed(const ParsedDate& parsed) {
    auto r = ::node::socketsecurity::temporal::PlainYearMonthTryNewIso(
        parsed.year(), parsed.month(), std::optional<uint8_t>{});
    if (!r.ok()) {
      return diplomat::Err<TemporalError>(
          TemporalError::FromInfra(r.error()));
    }
    ::node::socketsecurity::temporal::PlainYearMonth inner = r.value();
    inner.calendar =
        static_cast<::node::socketsecurity::temporal::CalendarKind>(
            parsed.ToInfra().calendar_kind);
    return diplomat::Ok<std::unique_ptr<PlainYearMonth>>(
        std::unique_ptr<PlainYearMonth>(new PlainYearMonth(inner)));
  }

  int32_t year() const {
    return ::node::socketsecurity::temporal::PlainYearMonthYear(inner_);
  }
  uint8_t month() const {
    return ::node::socketsecurity::temporal::PlainYearMonthMonth(inner_);
  }
  uint8_t days_in_month() const {
    ::node::socketsecurity::temporal::Calendar cal(inner_.calendar);
    return ::node::socketsecurity::temporal::CalendarDaysInMonth(cal,
                                                                   inner_.iso);
  }
  bool in_leap_year() const {
    ::node::socketsecurity::temporal::Calendar cal(inner_.calendar);
    return ::node::socketsecurity::temporal::CalendarInLeapYear(cal, inner_.iso);
  }
  bool is_valid() const { return inner_.IsValid(); }

  // Calendar-aware accessors. Inner POD carries CalendarKind; non-ISO
  // answers route through the active CalendarBackend.
  Calendar calendar() const {
    return Calendar(
        ::node::socketsecurity::temporal::Calendar(inner_.calendar));
  }
  uint16_t days_in_year() const {
    ::node::socketsecurity::temporal::Calendar cal(inner_.calendar);
    return ::node::socketsecurity::temporal::CalendarDaysInYear(cal, inner_.iso);
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

  // Conversion: PlainYearMonth + day -> PlainDate.
  template <class PD>
  diplomat::result<std::unique_ptr<PD>, TemporalError> to_plain_date(
      const PD* /*reference_day_date*/) const {
    auto r = ::node::socketsecurity::temporal::PlainDateTryNewIso(
        inner_.iso.year, inner_.iso.month, inner_.iso.day);
    if (!r.ok()) {
      return diplomat::Err<TemporalError>(
          TemporalError::FromInfra(r.error()));
    }
    return diplomat::Ok<std::unique_ptr<PD>>(PD::FromInfra(r.value()));
  }

  // 1:1 from upstream plain_year_month.rs:619 `epoch_ns_for_utc`.
  // Combines (iso.date, IsoTime::noon) and returns epoch ms in UTC.
  diplomat::result<int64_t, TemporalError> epoch_ms_for_with_provider(
      const Provider& p) const {
    auto utc = ::node::socketsecurity::temporal::TimeZone::Utc();
    TimeZone tz = TimeZone::FromInfra(utc);
    return epoch_ms_for_with_provider(tz, p);
  }

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

// ── Cross-class out-of-line definitions ──────────────────────────────
// PlainDate::to_plain_year_month's body lives here because
// PlainYearMonth is forward-declared in PlainDate.hpp.

inline diplomat::result<std::unique_ptr<PlainYearMonth>, TemporalError>
PlainDate::to_plain_year_month() const {
  // ISO path: pass year + month directly, preserve day as the
  // reference_day. Validity gated by IsoDate::IsValid (the C6 fix
  // does the per-month day check).
  auto result = ::node::socketsecurity::temporal::PlainYearMonthTryNewIso(
      inner_.iso.year, inner_.iso.month, inner_.iso.day);
  if (!result.ok()) {
    return diplomat::Err<TemporalError>(
        TemporalError::FromInfra(result.error()));
  }
  return diplomat::Ok<std::unique_ptr<PlainYearMonth>>(
      PlainYearMonth::FromInfra(result.value()));
}

}  // namespace temporal_rs

#endif  // TEMPORAL_RS_COMPAT_PLAINYEARMONTH_HPP_
