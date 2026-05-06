// 1:1 port of upstream `src/builtins/core/plain_date.rs` at
// temporal v0.2.3 (c003cc92325e19b26f8ee2f85e4a47d98cbcc781).
//
// `PlainDate` is the calendar-aware date wrapper. Internal layout
// matches upstream 1:1: `PlainDate { iso: IsoDate, calendar: Calendar }`.
// The Calendar class is forward-declared (calendar.h forthcoming);
// for now the port handles the ISO calendar path, which is what most
// callers take.
//
// `PartialDate` mirrors upstream's `PartialDate` companion struct —
// optional fields used by `with()` to override individual components.

#ifndef SRC_SOCKETSECURITY_TEMPORAL_PLAIN_DATE_H_
#define SRC_SOCKETSECURITY_TEMPORAL_PLAIN_DATE_H_

#include <cstddef>
#include <cstdint>
#include <optional>

#include "socketsecurity/temporal/error.h"
#include "socketsecurity/temporal/options.h"
#include "socketsecurity/temporal/temporal.h"

namespace node {
namespace socketsecurity {
namespace temporal {

// Mirror of upstream's `PartialDate`. Calendar omitted for now (ISO
// implied); month_code/era/era_year are calendar-extension fields that
// only apply to non-ISO calendars and remain unbound until calendar.h.
struct PartialDate {
  std::optional<int32_t> year;
  std::optional<uint8_t> month;
  std::optional<uint8_t> day;
  // Pending calendar.cc:
  // std::optional<MonthCode> month_code;
  // std::optional<TinyAsciiStr<19>> era;
  // std::optional<int32_t> era_year;

  bool IsEmpty() const noexcept { return !year && !month && !day; }
};

// Mirror of upstream's `PlainDate { iso, calendar }`.
struct PlainDate {
  IsoDate iso;
  // Calendar omitted (ISO implied); see calendar.h.

  bool IsValid() const noexcept { return iso.IsValid(); }
};

// Mirror of upstream's `PlainDate::try_new_iso`.
TemporalResult<PlainDate> PlainDateTryNewIso(int32_t year, uint8_t month,
                                              uint8_t day) noexcept;

// Mirror of upstream's `PlainDate::new_with_overflow` (ISO calendar
// path only for now).
TemporalResult<PlainDate> PlainDateNewWithOverflow(int32_t year,
                                                    uint8_t month, uint8_t day,
                                                    Overflow overflow) noexcept;

// Mirror of upstream's `PlainDate::from_partial`.
TemporalResult<PlainDate> PlainDateFromPartial(
    const PartialDate& partial,
    std::optional<Overflow> overflow) noexcept;

// Mirror of upstream's `PlainDate::from_utf8`.
TemporalResult<PlainDate> PlainDateFromUtf8(const uint8_t* data,
                                              size_t length) noexcept;

// Mirror of upstream's `with`.
TemporalResult<PlainDate> PlainDateWith(const PlainDate& base,
                                          const PartialDate& partial,
                                          std::optional<Overflow> overflow) noexcept;

// Field accessors (mirror upstream `year` / `month` / `day` / etc.).
int32_t PlainDateYear(const PlainDate& self) noexcept;
uint8_t PlainDateMonth(const PlainDate& self) noexcept;
uint8_t PlainDateDay(const PlainDate& self) noexcept;
uint8_t PlainDateDayOfWeek(const PlainDate& self) noexcept;
uint16_t PlainDateDayOfYear(const PlainDate& self) noexcept;
uint8_t PlainDateWeekOfYear(const PlainDate& self) noexcept;
uint8_t PlainDateDaysInMonth(const PlainDate& self) noexcept;
uint16_t PlainDateDaysInYear(const PlainDate& self) noexcept;
bool PlainDateInLeapYear(const PlainDate& self) noexcept;

// Mirror of upstream's `add` / `subtract` for ISO-only paths.
TemporalResult<PlainDate> PlainDateAdd(const PlainDate& base,
                                        const Duration& duration,
                                        std::optional<Overflow> overflow) noexcept;
TemporalResult<PlainDate> PlainDateSubtract(
    const PlainDate& base, const Duration& duration,
    std::optional<Overflow> overflow) noexcept;

// Mirror of upstream's `until` / `since` (ISO-day path only — full
// calendar-aware diff lands with calendar.cc).
TemporalResult<Duration> PlainDateUntil(const PlainDate& self,
                                          const PlainDate& other) noexcept;
TemporalResult<Duration> PlainDateSince(const PlainDate& self,
                                          const PlainDate& other) noexcept;

}  // namespace temporal
}  // namespace socketsecurity
}  // namespace node

#endif  // SRC_SOCKETSECURITY_TEMPORAL_PLAIN_DATE_H_
