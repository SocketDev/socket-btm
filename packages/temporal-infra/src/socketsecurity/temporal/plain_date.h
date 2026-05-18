// 1:1 port of upstream `src/builtins/core/plain_date.rs` at
// temporal v0.2.3 (c003cc92325e19b26f8ee2f85e4a47d98cbcc781).
//
// Lock-step from Rust: builtins/core/plain_date.rs
//
// `PlainDate` is the calendar-aware date wrapper. Internal layout
// matches upstream 1:1: `PlainDate { iso: IsoDate, calendar: Calendar }`.
// The C++ POD here holds only `iso`; non-ISO calendar values are
// carried alongside by the V8 binding (separate Object slot).
// Non-ISO calendar arithmetic routes through the registered
// CalendarBackend (see calendar.h).
//
// `PartialDate` mirrors upstream's `PartialDate` companion struct —
// optional fields used by `with()` to override individual components.

#ifndef SRC_SOCKETSECURITY_TEMPORAL_PLAIN_DATE_H_
#define SRC_SOCKETSECURITY_TEMPORAL_PLAIN_DATE_H_

#include <cstddef>
#include <cstdint>
#include <optional>

#include "socketsecurity/temporal/calendar.h"
#include "socketsecurity/temporal/error.h"
#include "socketsecurity/temporal/options.h"
#include "socketsecurity/temporal/temporal.h"

namespace node {
namespace socketsecurity {
namespace temporal {

// Mirror of upstream's `PartialDate`. ISO surface only — non-ISO
// calendar fields (month_code, era, era_year) are carried by the V8
// binding alongside this struct, since they only apply to non-ISO
// calendars and the binding owns the Calendar slot.
struct PartialDate {
  std::optional<int32_t> year;
  std::optional<uint8_t> month;
  std::optional<uint8_t> day;

  bool IsEmpty() const noexcept { return !year && !month && !day; }
};

// `struct PlainDate` is defined in temporal.h (canonical home — plain_date.h
// would create a redefinition since both headers get pulled into V8's
// translation units). Original duplicate kept commented for legibility:
//
// struct PlainDate {
//   IsoDate iso;
//   // Calendar omitted (ISO implied); see calendar.h.
//   bool IsValid() const noexcept { return iso.IsValid(); }
// };

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

// Calendar-aware variant of PlainDateFromPartial. Accepts the
// non-ISO calendar extension fields (era / era_year / month_code)
// alongside the bare numeric fields, dispatches through the
// CalendarBackend to resolve era → year (when era is set) and
// month_code → ordinal_month (when month_code is set), then walks
// the resulting (kind, year, ordinal_month, day) through
// IsoFromCalendarFields. The returned PlainDate carries the
// requested calendar on its `calendar` slot.
//
// For kIso: era / era_year / month_code must be empty; otherwise
// returns Range error. Same shape as upstream's
// `PlainDate::from_partial` when the partial carries non-empty
// extension fields.
//
// MonthCode / Era / CalendarKind are defined in calendar.h, included
// above.
TemporalResult<PlainDate> PlainDateFromPartialWithCalendar(
    CalendarKind calendar, const PartialDate& iso_partial,
    const Era& era, bool has_era, int32_t era_year, bool has_era_year,
    const MonthCode& month_code, bool has_month_code,
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
