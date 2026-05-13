// 1:1 port of upstream `src/builtins/core/plain_month_day.rs`.

#include "socketsecurity/temporal/plain_month_day.h"

#include <string_view>

#include "socketsecurity/temporal/calendar.h"
#include "socketsecurity/temporal/iso.h"
#include "socketsecurity/temporal/parse.h"

namespace node {
namespace socketsecurity {
namespace temporal {

namespace {
// Upstream uses 1972 as the reference year (leap year, so Feb 29 is
// representable). Spec: "the reference year for a Temporal.PlainMonthDay
// is 1972."
constexpr int32_t kReferenceYear = 1972;
}  // namespace

TemporalResult<PlainMonthDay> PlainMonthDayTryNewIso(
    uint8_t month, uint8_t day,
    std::optional<int32_t> reference_year) noexcept {
  const int32_t year = reference_year.value_or(kReferenceYear);
  if (year < -271821 || year > 275760) {
    return TemporalError::Range("reference year out of range");
  }
  if (month < 1 || month > 12) {
    return TemporalError::Range("month out of range");
  }
  if (day < 1 || day > ISODaysInMonth(year, month)) {
    return TemporalError::Range("day out of range for given month");
  }
  PlainMonthDay out{};
  out.iso.year = year;
  out.iso.month = month;
  out.iso.day = day;
  return out;
}

TemporalResult<PlainMonthDay> PlainMonthDayFromUtf8(
    const uint8_t* data, size_t length) noexcept {
  std::string_view view(reinterpret_cast<const char*>(data), length);
  ParseDateTimeRecord rec;
  if (ParseMonthDay(view, &rec) != ParseStatus::kOk) {
    return TemporalError::Range("Invalid PlainMonthDay string");
  }
  PlainMonthDay out{};
  out.iso = rec.datetime.iso.date;
  // Spec: year is reference-only; canonical rep stores 1972.
  out.iso.year = kReferenceYear;
  // Propagate [u-ca=...] annotation so non-ISO calendars (Hebrew M05L,
  // Coptic M13, etc.) get their kind preserved through string parsing.
  if (rec.calendar_len > 0) {
    auto kind = Calendar::TryKindFromUtf8(
        reinterpret_cast<const uint8_t*>(rec.calendar), rec.calendar_len);
    if (kind.ok()) {
      out.calendar = kind.value();
    }
  }
  return out;
}

uint8_t PlainMonthDayMonth(const PlainMonthDay& self) noexcept {
  return self.iso.month;
}

uint8_t PlainMonthDayDay(const PlainMonthDay& self) noexcept {
  return self.iso.day;
}

}  // namespace temporal
}  // namespace socketsecurity
}  // namespace node
