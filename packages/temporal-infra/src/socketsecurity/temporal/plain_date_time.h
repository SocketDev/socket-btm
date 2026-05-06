// 1:1 port of upstream `src/builtins/core/plain_date_time.rs` at
// temporal v0.2.3 (c003cc92325e19b26f8ee2f85e4a47d98cbcc781).
//
// `PlainDateTime` is the calendar-aware date+time wrapper. Internal
// layout matches upstream: `PlainDateTime { iso: IsoDateTime,
// calendar: Calendar }` (calendar forward-declared until calendar.h).

#ifndef SRC_SOCKETSECURITY_TEMPORAL_PLAIN_DATE_TIME_H_
#define SRC_SOCKETSECURITY_TEMPORAL_PLAIN_DATE_TIME_H_

#include <cstddef>
#include <cstdint>
#include <optional>

#include "socketsecurity/temporal/error.h"
#include "socketsecurity/temporal/options.h"
#include "socketsecurity/temporal/plain_date.h"
#include "socketsecurity/temporal/plain_time.h"
#include "socketsecurity/temporal/temporal.h"

namespace node {
namespace socketsecurity {
namespace temporal {

// Mirror of upstream's `PartialDateTime`. Decomposed into the date
// fields (PartialDate) and time fields (PartialTime).
struct PartialDateTime {
  PartialDate date;
  PartialTime time;

  bool IsEmpty() const noexcept { return date.IsEmpty() && time.IsEmpty(); }
};

// PlainDateTime is already declared in temporal.h as
// `struct PlainDateTime { IsoDateTime iso; }`. The methods here mirror
// upstream's `impl PlainDateTime` blocks.

// Mirror of upstream's `PlainDateTime::try_new` (ISO calendar path).
TemporalResult<PlainDateTime> PlainDateTimeTryNew(
    int32_t year, uint8_t month, uint8_t day, uint8_t hour, uint8_t minute,
    uint8_t second, uint16_t millisecond, uint16_t microsecond,
    uint16_t nanosecond) noexcept;

// Mirror of upstream's `PlainDateTime::new_with_overflow`.
TemporalResult<PlainDateTime> PlainDateTimeNewWithOverflow(
    int32_t year, uint8_t month, uint8_t day, uint8_t hour, uint8_t minute,
    uint8_t second, uint16_t millisecond, uint16_t microsecond,
    uint16_t nanosecond, Overflow overflow) noexcept;

// Mirror of upstream's `PlainDateTime::from_partial`.
TemporalResult<PlainDateTime> PlainDateTimeFromPartial(
    const PartialDateTime& partial,
    std::optional<Overflow> overflow) noexcept;

// Mirror of upstream's `PlainDateTime::from_utf8`.
TemporalResult<PlainDateTime> PlainDateTimeFromUtf8(const uint8_t* data,
                                                      size_t length) noexcept;

// Mirror of upstream's `with`.
TemporalResult<PlainDateTime> PlainDateTimeWith(
    const PlainDateTime& base, const PartialDateTime& partial,
    std::optional<Overflow> overflow) noexcept;

// Field accessors.
int32_t PlainDateTimeYear(const PlainDateTime& self) noexcept;
uint8_t PlainDateTimeMonth(const PlainDateTime& self) noexcept;
uint8_t PlainDateTimeDay(const PlainDateTime& self) noexcept;
uint8_t PlainDateTimeHour(const PlainDateTime& self) noexcept;
uint8_t PlainDateTimeMinute(const PlainDateTime& self) noexcept;
uint8_t PlainDateTimeSecond(const PlainDateTime& self) noexcept;
uint16_t PlainDateTimeMillisecond(const PlainDateTime& self) noexcept;
uint16_t PlainDateTimeMicrosecond(const PlainDateTime& self) noexcept;
uint16_t PlainDateTimeNanosecond(const PlainDateTime& self) noexcept;

// Mirror of upstream's `to_plain_date` / `to_plain_time`. Returns the
// underlying ISO record wrapped in the corresponding type.
PlainDate PlainDateTimeToPlainDate(const PlainDateTime& self) noexcept;
PlainTime PlainDateTimeToPlainTime(const PlainDateTime& self) noexcept;

// Mirror of upstream's `add` / `subtract`.
TemporalResult<PlainDateTime> PlainDateTimeAdd(
    const PlainDateTime& base, const Duration& duration,
    std::optional<Overflow> overflow) noexcept;
TemporalResult<PlainDateTime> PlainDateTimeSubtract(
    const PlainDateTime& base, const Duration& duration,
    std::optional<Overflow> overflow) noexcept;

// Mirror of upstream's `until` / `since` (ISO-only path; full
// calendar-aware diff lands with calendar.cc).
TemporalResult<Duration> PlainDateTimeUntil(const PlainDateTime& self,
                                              const PlainDateTime& other) noexcept;
TemporalResult<Duration> PlainDateTimeSince(const PlainDateTime& self,
                                              const PlainDateTime& other) noexcept;

}  // namespace temporal
}  // namespace socketsecurity
}  // namespace node

#endif  // SRC_SOCKETSECURITY_TEMPORAL_PLAIN_DATE_TIME_H_
