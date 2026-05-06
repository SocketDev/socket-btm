// 1:1 port of upstream `src/builtins/core/plain_year_month.rs` at
// temporal v0.2.3 (c003cc92325e19b26f8ee2f85e4a47d98cbcc781).
//
// `PlainYearMonth` is a calendar-aware month within a year (e.g.
// "January 2024"). Internally stored as an IsoDate (with `day` set to a
// reference value) plus a Calendar identifier. The day is part of the
// internal representation per spec but not part of the observable API.
//
// Calendar field is forward-declared (calendar.h forthcoming); for now
// the port handles the ISO calendar path, which is what most callers
// take.

#ifndef SRC_SOCKETSECURITY_TEMPORAL_PLAIN_YEAR_MONTH_H_
#define SRC_SOCKETSECURITY_TEMPORAL_PLAIN_YEAR_MONTH_H_

#include <cstdint>
#include <optional>

#include "socketsecurity/temporal/error.h"
#include "socketsecurity/temporal/plain_time.h"  // For Overflow enum
#include "socketsecurity/temporal/temporal.h"

namespace node {
namespace socketsecurity {
namespace temporal {

// Mirror of upstream's `PlainYearMonth { iso, calendar }`.
struct PlainYearMonth {
  IsoDate iso;
  // calendar field placeholder (calendar.h forthcoming).
  // const Calendar* calendar = nullptr;

  bool IsValid() const noexcept { return iso.IsValid(); }
};

// Mirror of upstream's `PlainYearMonth::try_new_iso`. Constrains the
// day to a valid value within `(year, month)` and rejects out-of-range
// year/month inputs.
TemporalResult<PlainYearMonth> PlainYearMonthTryNewIso(
    int32_t year, uint8_t month,
    std::optional<uint8_t> reference_day) noexcept;

// Mirror of upstream's `PlainYearMonth::from_utf8`.
TemporalResult<PlainYearMonth> PlainYearMonthFromUtf8(
    const uint8_t* data, size_t length) noexcept;

// Mirror of upstream's `year` / `month` accessors.
int32_t PlainYearMonthYear(const PlainYearMonth& self) noexcept;
uint8_t PlainYearMonthMonth(const PlainYearMonth& self) noexcept;

// Mirror of upstream's `days_in_month`. ISO-only for now.
uint8_t PlainYearMonthDaysInMonth(const PlainYearMonth& self) noexcept;

// Mirror of upstream's `in_leap_year`. ISO-only for now.
bool PlainYearMonthInLeapYear(const PlainYearMonth& self) noexcept;

}  // namespace temporal
}  // namespace socketsecurity
}  // namespace node

#endif  // SRC_SOCKETSECURITY_TEMPORAL_PLAIN_YEAR_MONTH_H_
