// 1:1 port of upstream `src/builtins/core/plain_date.rs`.

#include "socketsecurity/temporal/plain_date.h"

#include <cmath>
#include <string_view>

#include "socketsecurity/temporal/calendar.h"
#include "socketsecurity/temporal/iso.h"
#include "socketsecurity/temporal/parse.h"

namespace node {
namespace socketsecurity {
namespace temporal {

TemporalResult<PlainDate> PlainDateTryNewIso(int32_t year, uint8_t month,
                                              uint8_t day) noexcept {
  return PlainDateNewWithOverflow(year, month, day, Overflow::kReject);
}

TemporalResult<PlainDate> PlainDateNewWithOverflow(int32_t year,
                                                    uint8_t month, uint8_t day,
                                                    Overflow overflow) noexcept {
  // Upstream: IsoDate::new(year, month, day, overflow), then wrap.
  PlainDate out{};
  if (overflow == Overflow::kReject) {
    out.iso = IsoDate{year, month, day};
    if (!out.iso.IsValid()) {
      return TemporalError::Range("Date component out of range");
    }
    // Validate per-month day count.
    if (day > ISODaysInMonth(year, month)) {
      return TemporalError::Range("day exceeds days-in-month");
    }
    return out;
  }
  // Constrain: regulate fields into range.
  out.iso = RegulateISODateConstrain(year, month, day);
  if (!out.iso.IsValid()) {
    return TemporalError::Range("Date component out of range");
  }
  return out;
}

TemporalResult<PlainDate> PlainDateFromPartial(
    const PartialDate& partial,
    std::optional<Overflow> overflow) noexcept {
  if (partial.IsEmpty()) {
    return TemporalError::Type("PartialDate cannot be empty.");
  }
  // Upstream pulls year/month/day from CalendarFields. ISO-only path:
  // require year, month, and day to be present (a stricter contract
  // than upstream's calendar-aware fill, but matches the ISO subset
  // until calendar.cc lands).
  if (!partial.year.has_value() || !partial.month.has_value() ||
      !partial.day.has_value()) {
    return TemporalError::Type(
        "ISO PartialDate requires year, month, and day");
  }
  return PlainDateNewWithOverflow(*partial.year, *partial.month,
                                   *partial.day,
                                   overflow.value_or(Overflow::kConstrain));
}

TemporalResult<PlainDate> PlainDateFromPartialWithCalendar(
    CalendarKind calendar, const PartialDate& iso_partial,
    const Era& era, bool has_era, int32_t era_year, bool has_era_year,
    const MonthCode& month_code, bool has_month_code,
    std::optional<Overflow> overflow) noexcept {
  // ISO calendar: era / era_year / month_code must all be absent.
  // Non-ISO inputs there are a spec-level type error.
  if (calendar == CalendarKind::kIso) {
    if (has_era || has_era_year || has_month_code) {
      return TemporalError::Range(
          "ISO calendar does not accept era / era_year / month_code "
          "— pass year + month + day directly");
    }
    auto p = PlainDateFromPartial(iso_partial, overflow);
    if (!p.ok()) return p.error();
    PlainDate out = p.value();
    out.calendar = calendar;
    return out;
  }

  // Non-ISO: resolve era → year if needed, month_code → ordinal_month
  // if needed, then walk IsoFromCalendarFields. day comes from
  // iso_partial.day (the spec carries day through unchanged).
  const Overflow ov = overflow.value_or(Overflow::kConstrain);

  // Step 1: year. era + era_year resolves to a proleptic year via
  // the backend. If `year` is also set, it must agree post-resolution.
  int32_t year = 0;
  if (has_era && has_era_year) {
    auto y = GetCalendarBackend().EraYearToIsoYear(calendar, era, era_year);
    if (!y.ok()) return y.error();
    year = y.value();
    if (iso_partial.year.has_value() && *iso_partial.year != year) {
      return TemporalError::Range(
          "year and (era, era_year) disagree on the same date");
    }
  } else if (has_era != has_era_year) {
    return TemporalError::Range(
        "era and era_year must be specified together");
  } else if (iso_partial.year.has_value()) {
    year = *iso_partial.year;
  } else {
    return TemporalError::Type(
        "PartialDate requires year or (era, era_year)");
  }

  // Step 2: ordinal_month. month_code resolves via the backend
  // (handles leap months per-calendar). If both `month` and
  // `month_code` are given, they must agree after resolution.
  uint8_t ordinal_month = 0;
  if (has_month_code) {
    auto m = GetCalendarBackend().ResolveMonthCode(calendar, year, month_code);
    if (!m.ok()) return m.error();
    ordinal_month = m.value();
    if (iso_partial.month.has_value() &&
        *iso_partial.month != ordinal_month) {
      return TemporalError::Range(
          "month and month_code disagree on the same date");
    }
  } else if (iso_partial.month.has_value()) {
    ordinal_month = *iso_partial.month;
  } else {
    return TemporalError::Type(
        "PartialDate requires month or month_code");
  }

  // Step 3: day.
  if (!iso_partial.day.has_value()) {
    return TemporalError::Type("PartialDate requires day");
  }
  const uint8_t day = *iso_partial.day;

  // Step 4: walk through the backend's IsoFromCalendarFields to land
  // on the IsoDate. The backend handles per-calendar arithmetic
  // (Hebrew leap months, Coptic M13, etc.).
  auto iso = GetCalendarBackend().IsoFromCalendarFields(
      calendar, year, ordinal_month, day, ov);
  if (!iso.ok()) return iso.error();

  PlainDate out{};
  out.iso = iso.value();
  out.calendar = calendar;
  return out;
}

TemporalResult<PlainDate> PlainDateFromUtf8(const uint8_t* data,
                                              size_t length) noexcept {
  std::string_view view(reinterpret_cast<const char*>(data), length);
  PlainDate out{};
  // Try ParseDateTime FIRST — it extracts the [u-ca=...] annotation.
  // ParseDate ignores annotations and would silently drop the calendar
  // identifier, leaving callers with out.calendar == kIso even when the
  // input carries [u-ca=hebrew] / [u-ca=japanese] / etc.
  ParseDateTimeRecord rec;
  if (ParseDateTime(view, &rec) == ParseStatus::kOk) {
    out.iso = rec.datetime.iso.date;
    // Propagate [u-ca=...] annotation into the inner POD so callers
    // see the right calendar identifier (Calendar::TryKindFromUtf8
    // returns kIso for unknown / empty inputs).
    if (rec.calendar_len > 0) {
      auto kind = Calendar::TryKindFromUtf8(
          reinterpret_cast<const uint8_t*>(rec.calendar), rec.calendar_len);
      if (kind.ok()) {
        out.calendar = kind.value();
      }
    }
    return out;
  }
  // Fall back to bare YYYY-MM-DD (no time, no annotations).
  if (ParseDate(view, &out) == ParseStatus::kOk) {
    return out;
  }
  return TemporalError::Range("Invalid PlainDate string");
}

TemporalResult<PlainDate> PlainDateWith(const PlainDate& base,
                                          const PartialDate& partial,
                                          std::optional<Overflow> overflow) noexcept {
  if (partial.IsEmpty()) {
    return TemporalError::Type("PartialDate cannot be empty.");
  }
  return PlainDateNewWithOverflow(
      partial.year.value_or(base.iso.year),
      partial.month.value_or(base.iso.month),
      partial.day.value_or(base.iso.day),
      overflow.value_or(Overflow::kConstrain));
}

int32_t PlainDateYear(const PlainDate& self) noexcept {
  if (self.calendar == CalendarKind::kIso) {
    return self.iso.year;
  }
  auto r = GetCalendarBackend().Year(self.calendar, self.iso);
  return r.ok() ? r.value() : self.iso.year;
}
uint8_t PlainDateMonth(const PlainDate& self) noexcept {
  if (self.calendar == CalendarKind::kIso) {
    return self.iso.month;
  }
  auto r = GetCalendarBackend().Month(self.calendar, self.iso);
  return r.ok() ? r.value() : self.iso.month;
}
uint8_t PlainDateDay(const PlainDate& self) noexcept {
  if (self.calendar == CalendarKind::kIso) {
    return self.iso.day;
  }
  auto r = GetCalendarBackend().Day(self.calendar, self.iso);
  return r.ok() ? r.value() : self.iso.day;
}

uint8_t PlainDateDayOfWeek(const PlainDate& self) noexcept {
  return ISODayOfWeek(self.iso.year, self.iso.month, self.iso.day);
}

uint16_t PlainDateDayOfYear(const PlainDate& self) noexcept {
  return ISODayOfYear(self.iso.year, self.iso.month, self.iso.day);
}

uint8_t PlainDateWeekOfYear(const PlainDate& self) noexcept {
  return ISOWeekOfYear(self.iso.year, self.iso.month, self.iso.day);
}

uint8_t PlainDateDaysInMonth(const PlainDate& self) noexcept {
  return ISODaysInMonth(self.iso.year, self.iso.month);
}

uint16_t PlainDateDaysInYear(const PlainDate& self) noexcept {
  return IsLeapYear(self.iso.year) ? 366 : 365;
}

bool PlainDateInLeapYear(const PlainDate& self) noexcept {
  return IsLeapYear(self.iso.year);
}

namespace {

// Helper: convert Duration's double fields to int32, saturating.
// NaN guard is essential — `static_cast<int32_t>(NaN)` is UB per
// [conv.fpint]/4. Caller is responsible for IsValid() on the Duration
// upstream; this is belt-and-suspenders for the noexcept boundary.
int32_t SaturatingToI32(double d) noexcept {
  if (std::isnan(d)) return 0;
  if (d > 2147483647.0) return 2147483647;
  if (d < -2147483648.0) return -2147483648;
  return static_cast<int32_t>(d);
}

}  // namespace

TemporalResult<PlainDate> PlainDateAdd(const PlainDate& base,
                                        const Duration& duration,
                                        std::optional<Overflow> overflow) noexcept {
  // Upstream's add_duration_to_date funnels through AddISODate for the
  // ISO calendar. The full path validates the duration first; here we
  // do a minimal check (IsValid) so callers get a meaningful error.
  if (!duration.IsValid()) {
    return TemporalError::Range("Duration is not valid");
  }
  // ISO calendar arithmetic ignores time-only fields when adding to a
  // date; upstream then checks the time-portion is zero before
  // committing. For our minimal port the time-portion is allowed but
  // ignored — when calendar.cc lands we'll add the spec-precise check.
  const int32_t years = SaturatingToI32(duration.years);
  const int32_t months = SaturatingToI32(duration.months);
  const int32_t weeks = SaturatingToI32(duration.weeks);
  const int32_t days = SaturatingToI32(duration.days);
  IsoDate result = AddISODate(base.iso, years, months, weeks, days);
  if (!result.IsValid()) {
    if (overflow.value_or(Overflow::kConstrain) == Overflow::kReject) {
      return TemporalError::Range("Resulting date is out of range");
    }
    // Constrain: AddISODate already balances; if still invalid the
    // result is genuinely outside the spec range.
    return TemporalError::Range("Resulting date is out of range");
  }
  PlainDate out{};
  out.iso = result;
  return out;
}

TemporalResult<PlainDate> PlainDateSubtract(
    const PlainDate& base, const Duration& duration,
    std::optional<Overflow> overflow) noexcept {
  // Upstream: subtract negates the duration and routes to add. We do
  // the same.
  Duration neg = duration;
  neg.years = -neg.years;
  neg.months = -neg.months;
  neg.weeks = -neg.weeks;
  neg.days = -neg.days;
  neg.hours = -neg.hours;
  neg.minutes = -neg.minutes;
  neg.seconds = -neg.seconds;
  neg.milliseconds = -neg.milliseconds;
  neg.microseconds = -neg.microseconds;
  neg.nanoseconds = -neg.nanoseconds;
  return PlainDateAdd(base, neg, overflow);
}

TemporalResult<Duration> PlainDateUntil(const PlainDate& self,
                                          const PlainDate& other) noexcept {
  // ISO-day path. DifferenceISODate already returns a Duration with
  // only `.days` populated; mirroring upstream's "largestUnit = day"
  // default. Calendar-aware year/month/week breakdown lands with
  // calendar.cc.
  return DifferenceISODate(self.iso, other.iso);
}

TemporalResult<Duration> PlainDateSince(const PlainDate& self,
                                          const PlainDate& other) noexcept {
  Duration d = DifferenceISODate(self.iso, other.iso);
  d.days = -d.days;
  return d;
}

}  // namespace temporal
}  // namespace socketsecurity
}  // namespace node
