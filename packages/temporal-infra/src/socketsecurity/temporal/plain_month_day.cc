// 1:1 port of upstream `src/builtins/core/plain_month_day.rs`.

#include "socketsecurity/temporal/plain_month_day.h"

#include <string_view>

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
  // Upstream: ParsedDate::month_day_from_utf8. Like year_month, our
  // parser doesn't yet handle the bare "MM-DD" form; for now require
  // a full date string and ignore the year.
  // TODO(temporal-port): real month-day grammar in parse.cc Phase 2.
  ParseDateTimeRecord rec;
  ParseStatus status = ParseDateTime(view, &rec);
  if (status == ParseStatus::kInvalid) {
    // Try with reference year prefix ("--MM-DD" → "1972-MM-DD").
    std::string padded("1972-");
    padded.append(view);
    status = ParseDateTime(padded, &rec);
  }
  if (status != ParseStatus::kOk) {
    return TemporalError::Range("Invalid PlainMonthDay string");
  }
  PlainMonthDay out{};
  out.iso = rec.datetime.iso.date;
  // Spec: year is reference-only; canonical rep stores 1972.
  out.iso.year = kReferenceYear;
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
