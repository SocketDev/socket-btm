// 1:1 port of upstream `src/builtins/core/zoned_date_time.rs`.
//
// SCAFFOLD — most operations require V8 zoneinfo64 + ICU calendar
// dispatch. The structural surface is in place so callers can
// compile against ZonedDateTime today; behavioral correctness for
// IANA zones lands when those bindings come online.

#include "socketsecurity/temporal/zoned_date_time.h"

#include <string_view>

#include "socketsecurity/temporal/parse.h"

namespace node {
namespace socketsecurity {
namespace temporal {

TemporalResult<ZonedDateTime> ZonedDateTimeTryNew(Instant instant,
                                                   TimeZone time_zone,
                                                   Calendar calendar) noexcept {
  if (!instant.IsValid()) {
    return TemporalError::Range("Instant out of range");
  }
  ZonedDateTime out{};
  out.instant = instant;
  out.time_zone = time_zone;
  out.calendar = calendar;
  return out;
}

TemporalResult<ZonedDateTime> ZonedDateTimeFromUtf8(
    const uint8_t* data, size_t length) noexcept {
  std::string_view view(reinterpret_cast<const char*>(data), length);
  // Upstream: parse via ParsedZonedDateTime which requires a
  // [TimeZoneAnnotation]. Today our parser doesn't surface annotations
  // (parse.cc Phase 2 work). Fall back to ParseInstantString if input
  // ends with offset; the resulting ZonedDateTime carries an
  // offset-only TimeZone.
  Instant inst{};
  if (ParseInstantString(view, &inst) != ParseStatus::kOk) {
    return TemporalError::Range(
        "ZonedDateTime IXDTF parsing not yet implemented "
        "(needs RFC 9557 [TimeZone] annotation support)");
  }
  ZonedDateTime out{};
  out.instant = inst;
  // Default to UTC zone + ISO calendar. Matches the spec's resolution
  // when the input has only Z (no [TimeZone]).
  out.time_zone = TimeZone::Utc();
  out.calendar = Calendar::Iso();
  return out;
}

namespace {

// Helper: compute IsoDateTime from instant + time_zone. Stub for
// non-offset zones.
TemporalResult<IsoDateTime> ToIsoDateTime(const ZonedDateTime& self) noexcept {
  return self.time_zone.GetIsoDateTimeFor(self.instant);
}

}  // namespace

int32_t ZonedDateTimeYear(const ZonedDateTime& self) noexcept {
  auto idt = ToIsoDateTime(self);
  return idt.ok() ? idt.value().date.year : 0;
}
uint8_t ZonedDateTimeMonth(const ZonedDateTime& self) noexcept {
  auto idt = ToIsoDateTime(self);
  return idt.ok() ? idt.value().date.month : 0;
}
uint8_t ZonedDateTimeDay(const ZonedDateTime& self) noexcept {
  auto idt = ToIsoDateTime(self);
  return idt.ok() ? idt.value().date.day : 0;
}
uint8_t ZonedDateTimeHour(const ZonedDateTime& self) noexcept {
  auto idt = ToIsoDateTime(self);
  return idt.ok() ? idt.value().time.hour : 0;
}
uint8_t ZonedDateTimeMinute(const ZonedDateTime& self) noexcept {
  auto idt = ToIsoDateTime(self);
  return idt.ok() ? idt.value().time.minute : 0;
}
uint8_t ZonedDateTimeSecond(const ZonedDateTime& self) noexcept {
  auto idt = ToIsoDateTime(self);
  return idt.ok() ? idt.value().time.second : 0;
}
uint16_t ZonedDateTimeMillisecond(const ZonedDateTime& self) noexcept {
  auto idt = ToIsoDateTime(self);
  return idt.ok() ? idt.value().time.millisecond : 0;
}
uint16_t ZonedDateTimeMicrosecond(const ZonedDateTime& self) noexcept {
  auto idt = ToIsoDateTime(self);
  return idt.ok() ? idt.value().time.microsecond : 0;
}
uint16_t ZonedDateTimeNanosecond(const ZonedDateTime& self) noexcept {
  auto idt = ToIsoDateTime(self);
  return idt.ok() ? idt.value().time.nanosecond : 0;
}

Instant ZonedDateTimeToInstant(const ZonedDateTime& self) noexcept {
  return self.instant;
}

TemporalResult<PlainDateTime> ZonedDateTimeToPlainDateTime(
    const ZonedDateTime& self) noexcept {
  auto idt = ToIsoDateTime(self);
  if (!idt.ok()) {
    return idt.error();
  }
  PlainDateTime out{};
  out.iso = idt.value();
  return out;
}

TemporalResult<PlainDate> ZonedDateTimeToPlainDate(
    const ZonedDateTime& self) noexcept {
  auto idt = ToIsoDateTime(self);
  if (!idt.ok()) {
    return idt.error();
  }
  PlainDate out{};
  out.iso = idt.value().date;
  return out;
}

TemporalResult<PlainTime> ZonedDateTimeToPlainTime(
    const ZonedDateTime& self) noexcept {
  auto idt = ToIsoDateTime(self);
  if (!idt.ok()) {
    return idt.error();
  }
  PlainTime out{};
  out.iso = idt.value().time;
  return out;
}

}  // namespace temporal
}  // namespace socketsecurity
}  // namespace node
