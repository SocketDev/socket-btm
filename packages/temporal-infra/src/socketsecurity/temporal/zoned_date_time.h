// 1:1 port of upstream `src/builtins/core/zoned_date_time.rs` at
// temporal v0.2.3 (c003cc92325e19b26f8ee2f85e4a47d98cbcc781).
//
// `ZonedDateTime` combines an Instant with a TimeZone and a Calendar.
// The full DST + offset disambiguation logic depends on V8's
// zoneinfo64 (for IANA zones) and the calendar.cc dispatcher (for
// non-ISO calendars). This header defines the structural surface;
// most methods stub to TemporalError until those land.

#ifndef SRC_SOCKETSECURITY_TEMPORAL_ZONED_DATE_TIME_H_
#define SRC_SOCKETSECURITY_TEMPORAL_ZONED_DATE_TIME_H_

#include <cstddef>
#include <cstdint>
#include <optional>

#include "socketsecurity/temporal/calendar.h"
#include "socketsecurity/temporal/error.h"
#include "socketsecurity/temporal/options.h"
#include "socketsecurity/temporal/temporal.h"
#include "socketsecurity/temporal/time_zone.h"

namespace node {
namespace socketsecurity {
namespace temporal {

// Mirror of upstream's `ZonedDateTime`.
struct ZonedDateTime {
  Instant instant;
  TimeZone time_zone;
  Calendar calendar;

  bool IsValid() const noexcept { return instant.IsValid(); }
};

// Mirror of upstream's `ZonedDateTime::try_new`.
TemporalResult<ZonedDateTime> ZonedDateTimeTryNew(
    Instant instant, TimeZone time_zone, Calendar calendar) noexcept;

// Mirror of upstream's `ZonedDateTime::from_utf8`.
TemporalResult<ZonedDateTime> ZonedDateTimeFromUtf8(const uint8_t* data,
                                                      size_t length) noexcept;

// Field accessors.
int32_t ZonedDateTimeYear(const ZonedDateTime& self) noexcept;
uint8_t ZonedDateTimeMonth(const ZonedDateTime& self) noexcept;
uint8_t ZonedDateTimeDay(const ZonedDateTime& self) noexcept;
uint8_t ZonedDateTimeHour(const ZonedDateTime& self) noexcept;
uint8_t ZonedDateTimeMinute(const ZonedDateTime& self) noexcept;
uint8_t ZonedDateTimeSecond(const ZonedDateTime& self) noexcept;
uint16_t ZonedDateTimeMillisecond(const ZonedDateTime& self) noexcept;
uint16_t ZonedDateTimeMicrosecond(const ZonedDateTime& self) noexcept;
uint16_t ZonedDateTimeNanosecond(const ZonedDateTime& self) noexcept;

// Mirror of upstream's `to_instant`.
Instant ZonedDateTimeToInstant(const ZonedDateTime& self) noexcept;

// Mirror of upstream's `to_plain_date_time` / `to_plain_date` / `to_plain_time`.
TemporalResult<PlainDateTime> ZonedDateTimeToPlainDateTime(
    const ZonedDateTime& self) noexcept;
TemporalResult<PlainDate> ZonedDateTimeToPlainDate(
    const ZonedDateTime& self) noexcept;
TemporalResult<PlainTime> ZonedDateTimeToPlainTime(
    const ZonedDateTime& self) noexcept;

}  // namespace temporal
}  // namespace socketsecurity
}  // namespace node

#endif  // SRC_SOCKETSECURITY_TEMPORAL_ZONED_DATE_TIME_H_
