// 1:1 port of upstream `src/builtins/core/plain_date_time.rs`.

#include "socketsecurity/temporal/plain_date_time.h"

#include <cmath>
#include <string_view>

#include "socketsecurity/temporal/duration_normalized.h"
#include "socketsecurity/temporal/iso.h"
#include "socketsecurity/temporal/parse.h"
#include "socketsecurity/temporal/utils.h"

namespace node {
namespace socketsecurity {
namespace temporal {

TemporalResult<PlainDateTime> PlainDateTimeTryNew(
    int32_t year, uint8_t month, uint8_t day, uint8_t hour, uint8_t minute,
    uint8_t second, uint16_t millisecond, uint16_t microsecond,
    uint16_t nanosecond) noexcept {
  return PlainDateTimeNewWithOverflow(year, month, day, hour, minute, second,
                                       millisecond, microsecond, nanosecond,
                                       Overflow::kReject);
}

TemporalResult<PlainDateTime> PlainDateTimeNewWithOverflow(
    int32_t year, uint8_t month, uint8_t day, uint8_t hour, uint8_t minute,
    uint8_t second, uint16_t millisecond, uint16_t microsecond,
    uint16_t nanosecond, Overflow overflow) noexcept {
  // Date portion via PlainDate.
  auto date = PlainDateNewWithOverflow(year, month, day, overflow);
  if (!date.ok()) {
    return date.error();
  }
  // Time portion via PlainTime.
  auto time = PlainTimeNewWithOverflow(hour, minute, second, millisecond,
                                        microsecond, nanosecond, overflow);
  if (!time.ok()) {
    return time.error();
  }
  PlainDateTime out{};
  out.iso.date = date.value().iso;
  out.iso.time = time.value().iso;
  return out;
}

TemporalResult<PlainDateTime> PlainDateTimeFromPartial(
    const PartialDateTime& partial,
    std::optional<Overflow> overflow) noexcept {
  if (partial.IsEmpty()) {
    return TemporalError::Type("PartialDateTime cannot be empty.");
  }
  // Date side.
  auto date = PlainDateFromPartial(partial.date, overflow);
  if (!date.ok()) {
    return date.error();
  }
  // Time side. PartialTime can be empty (zero-fill); only build a time
  // from it when at least one field is set, otherwise default to zero.
  PlainTime time{};
  if (!partial.time.IsEmpty()) {
    auto t = PlainTimeFromPartial(partial.time, overflow);
    if (!t.ok()) {
      return t.error();
    }
    time = t.value();
  }
  PlainDateTime out{};
  out.iso.date = date.value().iso;
  out.iso.time = time.iso;
  return out;
}

TemporalResult<PlainDateTime> PlainDateTimeFromUtf8(
    const uint8_t* data, size_t length) noexcept {
  std::string_view view(reinterpret_cast<const char*>(data), length);
  ParseDateTimeRecord rec;
  if (ParseDateTime(view, &rec) != ParseStatus::kOk) {
    return TemporalError::Range("Invalid PlainDateTime string");
  }
  // Per upstream: PlainDateTime accepts strings with or without offset;
  // an offset is permitted and ignored (the timezone-bearing variant
  // is ZonedDateTime).
  PlainDateTime out{};
  out.iso = rec.datetime.iso;
  if (!out.IsValid()) {
    return TemporalError::Range("PlainDateTime out of range");
  }
  return out;
}

TemporalResult<PlainDateTime> PlainDateTimeWith(
    const PlainDateTime& base, const PartialDateTime& partial,
    std::optional<Overflow> overflow) noexcept {
  if (partial.IsEmpty()) {
    return TemporalError::Type("PartialDateTime cannot be empty.");
  }
  return PlainDateTimeNewWithOverflow(
      partial.date.year.value_or(base.iso.date.year),
      partial.date.month.value_or(base.iso.date.month),
      partial.date.day.value_or(base.iso.date.day),
      partial.time.hour.value_or(base.iso.time.hour),
      partial.time.minute.value_or(base.iso.time.minute),
      partial.time.second.value_or(base.iso.time.second),
      partial.time.millisecond.value_or(base.iso.time.millisecond),
      partial.time.microsecond.value_or(base.iso.time.microsecond),
      partial.time.nanosecond.value_or(base.iso.time.nanosecond),
      overflow.value_or(Overflow::kConstrain));
}

int32_t PlainDateTimeYear(const PlainDateTime& self) noexcept {
  return self.iso.date.year;
}
uint8_t PlainDateTimeMonth(const PlainDateTime& self) noexcept {
  return self.iso.date.month;
}
uint8_t PlainDateTimeDay(const PlainDateTime& self) noexcept {
  return self.iso.date.day;
}
uint8_t PlainDateTimeHour(const PlainDateTime& self) noexcept {
  return self.iso.time.hour;
}
uint8_t PlainDateTimeMinute(const PlainDateTime& self) noexcept {
  return self.iso.time.minute;
}
uint8_t PlainDateTimeSecond(const PlainDateTime& self) noexcept {
  return self.iso.time.second;
}
uint16_t PlainDateTimeMillisecond(const PlainDateTime& self) noexcept {
  return self.iso.time.millisecond;
}
uint16_t PlainDateTimeMicrosecond(const PlainDateTime& self) noexcept {
  return self.iso.time.microsecond;
}
uint16_t PlainDateTimeNanosecond(const PlainDateTime& self) noexcept {
  return self.iso.time.nanosecond;
}

PlainDate PlainDateTimeToPlainDate(const PlainDateTime& self) noexcept {
  PlainDate d{};
  d.iso = self.iso.date;
  return d;
}

PlainTime PlainDateTimeToPlainTime(const PlainDateTime& self) noexcept {
  PlainTime t{};
  t.iso = self.iso.time;
  return t;
}

namespace {

// Saturating cast f64 → i32 for date components. NaN → 0 prevents
// UB from `static_cast<int32_t>(NaN)` per [conv.fpint]/4.
int32_t SaturatingI32(double d) noexcept {
  if (std::isnan(d)) return 0;
  if (d > 2147483647.0) return 2147483647;
  if (d < -2147483648.0) return -2147483648;
  return static_cast<int32_t>(d);
}

// Mirror upstream's `PlainDateTime::add_or_subtract_duration` (the ISO
// path). Two-phase: time arithmetic (carries day overflow) then
// date arithmetic via AddISODate.
TemporalResult<PlainDateTime> AddOrSubtractToDateTime(
    const PlainDateTime& base, const Duration& duration,
    Overflow overflow) noexcept {
  // 1. TimeDuration component (24-hour days included).
  TimeDuration nt = TimeDuration::FromDuration(duration);
  auto with_days = nt.AddDays(static_cast<int64_t>(duration.days));
  if (!with_days.ok()) {
    return with_days.error();
  }

  // 2. Apply to the base time, capturing any day overflow.
  PlainTime base_pt{};
  base_pt.iso = base.iso.time;
  auto balanced = AddIsoTime(base_pt.iso, with_days.value());
  // 3. AdjustDateDurationRecord: feed days into the date side.
  IsoDate result_date = AddISODate(
      base.iso.date, SaturatingI32(duration.years),
      SaturatingI32(duration.months), SaturatingI32(duration.weeks),
      static_cast<int32_t>(balanced.days));
  if (!result_date.IsValid()) {
    if (overflow == Overflow::kReject) {
      return TemporalError::Range("Resulting date is out of range");
    }
    return TemporalError::Range("Resulting date is out of range");
  }
  PlainDateTime out{};
  out.iso.date = result_date;
  out.iso.time = balanced.time;
  if (!out.IsValid()) {
    return TemporalError::Range("Resulting PlainDateTime is out of range");
  }
  return out;
}

Duration NegateDuration(const Duration& d) noexcept {
  Duration out = d;
  out.years = -out.years;
  out.months = -out.months;
  out.weeks = -out.weeks;
  out.days = -out.days;
  out.hours = -out.hours;
  out.minutes = -out.minutes;
  out.seconds = -out.seconds;
  out.milliseconds = -out.milliseconds;
  out.microseconds = -out.microseconds;
  out.nanoseconds = -out.nanoseconds;
  return out;
}

// DiffDateTime: emit a (date + time) Duration via the time pipeline
// then the date pipeline. Largest-unit defaults to `nanosecond` for
// the time part and `day` for the date part — matches upstream's
// `diff_dt_with_rounding` for the no-rounding case.
TemporalResult<Duration> DiffDateTime(const PlainDateTime& self,
                                        const PlainDateTime& other,
                                        bool since) noexcept {
  TimeDuration time_delta = DiffIsoTime(self.iso.time, other.iso.time);
  Int128 ns = time_delta.Nanoseconds();
  Duration date_part = DifferenceISODate(self.iso.date, other.iso.date);
  if (since) {
    ns = -ns;
    date_part.days = -date_part.days;
    date_part.years = -date_part.years;
    date_part.months = -date_part.months;
    date_part.weeks = -date_part.weeks;
  }
  // Spec: BalanceTimeDurationRelative — date_part.days and the time
  // portion must share the same sign. When they disagree (the
  // "cross-midnight" case, e.g. earlier=23:00 → later=01:00 the next
  // day), transfer one whole day from the date portion to the time
  // portion: days -= sign(days); ns += sign(days) * kNsPerDay.
  // Without this the resulting Duration fails IsValid() per the
  // sign-agreement rule, surfacing as a confusing JS-side error.
  const Int128 ns_per_day(static_cast<int64_t>(kNsPerDay));
  if (date_part.days != 0 && ns != Int128(0)) {
    const bool date_negative = date_part.days < 0;
    const bool time_negative = ns < Int128(0);
    if (date_negative != time_negative) {
      if (date_negative) {
        date_part.days += 1;
        ns -= ns_per_day;
      } else {
        date_part.days -= 1;
        ns += ns_per_day;
      }
    }
  }
  // Decompose ns into time components (hours .. nanoseconds).
  bool negative = ns < Int128(0);
  Int128 abs_ns = negative ? -ns : ns;
  const Int128 ns_per_hour(static_cast<int64_t>(kNsPerHour));
  const Int128 ns_per_min(static_cast<int64_t>(kNsPerMinute));
  const Int128 ns_per_sec(static_cast<int64_t>(kNsPerSecond));
  const Int128 ns_per_milli(static_cast<int64_t>(kNsPerMillisecond));
  const Int128 ns_per_micro(static_cast<int64_t>(kNsPerMicrosecond));
  Int128 hours = abs_ns / ns_per_hour;
  Int128 r = abs_ns % ns_per_hour;
  Int128 minutes = r / ns_per_min;
  r = r % ns_per_min;
  Int128 secs = r / ns_per_sec;
  r = r % ns_per_sec;
  Int128 millis = r / ns_per_milli;
  r = r % ns_per_milli;
  Int128 micros = r / ns_per_micro;
  r = r % ns_per_micro;
  Int128 nanos = r;
  const double tsign = negative ? -1.0 : 1.0;

  Duration out{};
  out.years = date_part.years;
  out.months = date_part.months;
  out.weeks = date_part.weeks;
  out.days = date_part.days;
  out.hours = tsign * static_cast<double>(hours.ToInt64());
  out.minutes = tsign * static_cast<double>(minutes.ToInt64());
  out.seconds = tsign * static_cast<double>(secs.ToInt64());
  out.milliseconds = tsign * static_cast<double>(millis.ToInt64());
  out.microseconds = tsign * static_cast<double>(micros.ToInt64());
  out.nanoseconds = tsign * static_cast<double>(nanos.ToInt64());
  return out;
}

}  // namespace

TemporalResult<PlainDateTime> PlainDateTimeAdd(
    const PlainDateTime& base, const Duration& duration,
    std::optional<Overflow> overflow) noexcept {
  return AddOrSubtractToDateTime(base, duration,
                                  overflow.value_or(Overflow::kConstrain));
}

TemporalResult<PlainDateTime> PlainDateTimeSubtract(
    const PlainDateTime& base, const Duration& duration,
    std::optional<Overflow> overflow) noexcept {
  return AddOrSubtractToDateTime(base, NegateDuration(duration),
                                  overflow.value_or(Overflow::kConstrain));
}

TemporalResult<Duration> PlainDateTimeUntil(
    const PlainDateTime& self, const PlainDateTime& other) noexcept {
  return DiffDateTime(self, other, /*since=*/false);
}

TemporalResult<Duration> PlainDateTimeSince(
    const PlainDateTime& self, const PlainDateTime& other) noexcept {
  return DiffDateTime(self, other, /*since=*/true);
}

}  // namespace temporal
}  // namespace socketsecurity
}  // namespace node
