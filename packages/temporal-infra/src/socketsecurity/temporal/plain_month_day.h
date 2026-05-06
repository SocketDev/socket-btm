// 1:1 port of upstream `src/builtins/core/plain_month_day.rs` at
// temporal v0.2.3 (c003cc92325e19b26f8ee2f85e4a47d98cbcc781).
//
// `PlainMonthDay` is a calendar-aware month-day pair without a year
// (e.g. "Birthday: March 15"). Internally stored as an IsoDate (with
// `year` set to a reference value, typically 1972 — a leap year so
// Feb 29 is representable) plus a Calendar identifier.

#ifndef SRC_SOCKETSECURITY_TEMPORAL_PLAIN_MONTH_DAY_H_
#define SRC_SOCKETSECURITY_TEMPORAL_PLAIN_MONTH_DAY_H_

#include <cstddef>
#include <cstdint>
#include <optional>

#include "socketsecurity/temporal/error.h"
#include "socketsecurity/temporal/temporal.h"

namespace node {
namespace socketsecurity {
namespace temporal {

// Mirror of upstream's `PlainMonthDay { iso, calendar }`.
struct PlainMonthDay {
  IsoDate iso;
  // calendar field placeholder (calendar.h forthcoming).
  // const Calendar* calendar = nullptr;

  bool IsValid() const noexcept { return iso.IsValid(); }
};

// Mirror of upstream's `PlainMonthDay::try_new_iso`.
TemporalResult<PlainMonthDay> PlainMonthDayTryNewIso(
    uint8_t month, uint8_t day,
    std::optional<int32_t> reference_year) noexcept;

// Mirror of upstream's `PlainMonthDay::from_utf8`.
TemporalResult<PlainMonthDay> PlainMonthDayFromUtf8(
    const uint8_t* data, size_t length) noexcept;

// Mirror of upstream's `month` / `day` accessors.
uint8_t PlainMonthDayMonth(const PlainMonthDay& self) noexcept;
uint8_t PlainMonthDayDay(const PlainMonthDay& self) noexcept;

}  // namespace temporal
}  // namespace socketsecurity
}  // namespace node

#endif  // SRC_SOCKETSECURITY_TEMPORAL_PLAIN_MONTH_DAY_H_
