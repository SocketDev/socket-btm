// 1:1 port of upstream `src/builtins/core/plain_date_time.rs`.

#include "socketsecurity/temporal/plain_date_time.h"

#include <string_view>

#include "socketsecurity/temporal/iso.h"
#include "socketsecurity/temporal/parse.h"

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

TemporalResult<PlainDateTime> PlainDateTimeAdd(
    const PlainDateTime& /*base*/, const Duration& /*duration*/,
    std::optional<Overflow> /*overflow*/) noexcept {
  // Full impl depends on TimeDuration normalization (duration.cc Phase
  // 2). Stub for now — returns Generic to mark "not yet ported."
  return TemporalError::Generic("PlainDateTime::Add not yet ported");
}

TemporalResult<PlainDateTime> PlainDateTimeSubtract(
    const PlainDateTime& /*base*/, const Duration& /*duration*/,
    std::optional<Overflow> /*overflow*/) noexcept {
  return TemporalError::Generic("PlainDateTime::Subtract not yet ported");
}

TemporalResult<Duration> PlainDateTimeUntil(
    const PlainDateTime& /*self*/, const PlainDateTime& /*other*/) noexcept {
  return TemporalError::Generic("PlainDateTime::Until not yet ported");
}

TemporalResult<Duration> PlainDateTimeSince(
    const PlainDateTime& /*self*/, const PlainDateTime& /*other*/) noexcept {
  return TemporalError::Generic("PlainDateTime::Since not yet ported");
}

}  // namespace temporal
}  // namespace socketsecurity
}  // namespace node
