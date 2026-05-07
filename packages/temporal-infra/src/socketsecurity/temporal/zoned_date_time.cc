// 1:1 port of upstream `src/builtins/core/zoned_date_time.rs`.
//
// Lock-step from Rust: builtins/core/zoned_date_time.rs
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
  ParseDateTimeRecord rec;
  if (ParseDateTime(view, &rec) != ParseStatus::kOk) {
    return TemporalError::Range("Invalid ZonedDateTime string");
  }
  // Spec: TemporalZonedDateTimeString requires a [TimeZone] annotation.
  if (rec.time_zone_len == 0) {
    return TemporalError::Range(
        "ZonedDateTime string requires a [TimeZone] annotation");
  }
  // Resolve the time zone identifier.
  const std::string_view tz_id(rec.time_zone, rec.time_zone_len);
  auto tz_result = TimeZone::TryFromIdentifierStr(tz_id);
  if (!tz_result.ok()) {
    return tz_result.error();
  }
  // Resolve the calendar identifier (default ISO when absent).
  Calendar calendar = Calendar::Iso();
  if (rec.calendar_len > 0) {
    auto cal_result = Calendar::TryFromUtf8(
        reinterpret_cast<const uint8_t*>(rec.calendar), rec.calendar_len);
    if (!cal_result.ok()) {
      return cal_result.error();
    }
    calendar = cal_result.value();
  }
  // Compute Instant from the parsed local datetime + offset (or UTC
  // when 'Z'). Mirror upstream's `interpret_isodatetime_offset` for
  // the "exact offset" path: if the input has an explicit offset, the
  // local datetime is anchored against that offset; if 'Z', it's UTC.
  // Without an offset (just [TimeZone]), call TimeZone::GetEpochNanosecondsFor
  // which routes to the active IcuTimeZoneBackend for wall-clock-to-
  // instant resolution using kCompatible disambiguation (spec default).
  Int128 epoch_ns;
  if (rec.has_offset) {
    // Exact-offset path: anchor local datetime against the explicit
    // offset (or UTC when 'Z').
    const IsoDate& d = rec.datetime.iso.date;
    int32_t a = (14 - d.month) / 12;
    int32_t y = d.year + 4800 - a;
    int32_t m = d.month + 12 * a - 3;
    int64_t jdn = static_cast<int64_t>(d.day) + (153 * m + 2) / 5 +
                  365LL * y + y / 4 - y / 100 + y / 400 - 32045;
    int64_t days_since_epoch = jdn - 2440588;
    const IsoTime& t = rec.datetime.iso.time;
    int64_t tod_ns = (static_cast<int64_t>(t.hour) * 3600 +
                      static_cast<int64_t>(t.minute) * 60 +
                      t.second) *
                         1'000'000'000LL +
                     static_cast<int64_t>(t.millisecond) * 1'000'000 +
                     static_cast<int64_t>(t.microsecond) * 1'000 +
                     t.nanosecond;
    Int128 day_ns = Int128(days_since_epoch) *
                     Int128(static_cast<int64_t>(86'400'000'000'000LL));
    epoch_ns = day_ns + Int128(tod_ns) - Int128(rec.offset_nanoseconds);
  } else {
    // No-offset path: defer to the IANA backend's
    // ResolveOffsetFromLocal via GetEpochNanosecondsFor. kCompatible
    // is the spec-default disambiguation for parse paths (fall-back
    // overlap → earlier instant, spring-forward gap → post-transition).
    auto epoch_result = tz_result.value().GetEpochNanosecondsFor(
        rec.datetime.iso, Disambiguation::kCompatible);
    if (!epoch_result.ok()) {
      return epoch_result.error();
    }
    epoch_ns = epoch_result.value();
  }

  ZonedDateTime out{};
  out.instant.epoch_nanoseconds = epoch_ns;
  if (!out.instant.IsValid()) {
    return TemporalError::Range(
        "ZonedDateTime epoch nanoseconds out of range");
  }
  out.time_zone = tz_result.value();
  out.calendar = calendar;
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
  out.calendar = self.calendar.Kind();
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
  out.calendar = self.calendar.Kind();
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
