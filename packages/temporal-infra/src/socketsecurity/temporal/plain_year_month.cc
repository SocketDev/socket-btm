// 1:1 port of upstream `src/builtins/core/plain_year_month.rs`.

#include "socketsecurity/temporal/plain_year_month.h"

#include <string_view>

#include "socketsecurity/temporal/iso.h"
#include "socketsecurity/temporal/parse.h"
#include "socketsecurity/temporal/parsed_intermediates.h"

namespace node {
namespace socketsecurity {
namespace temporal {

TemporalResult<PlainYearMonth> PlainYearMonthTryNewIso(
    int32_t year, uint8_t month,
    std::optional<uint8_t> reference_day) noexcept {
  // Spec / upstream: validate year, month; pick a reference day that's
  // within the month's days-in-month. Default reference day is 1.
  if (year < -271821 || year > 275760) {
    return TemporalError::Range("year out of range");
  }
  if (month < 1 || month > 12) {
    return TemporalError::Range("month out of range");
  }
  const uint8_t max_day = ISODaysInMonth(year, month);
  uint8_t day = reference_day.value_or(1);
  if (day < 1 || day > max_day) {
    return TemporalError::Range("reference day out of range for given month");
  }
  PlainYearMonth out{};
  out.iso.year = year;
  out.iso.month = month;
  out.iso.day = day;
  return out;
}

TemporalResult<PlainYearMonth> PlainYearMonthFromUtf8(
    const uint8_t* data, size_t length) noexcept {
  std::string_view view(reinterpret_cast<const char*>(data), length);
  // Upstream: ParsedDate::year_month_from_utf8. Today our parser only
  // handles full DateTime; this still works for "YYYY-MM" because the
  // current impl rejects RFC 9557 calendar annotations (TODO Phase 2).
  // For now, accept "YYYY-MM" by appending "-01" before parsing.
  // TODO(temporal-port): wire real year-month grammar through parse.cc.
  ParseDateTimeRecord rec;
  ParseStatus status = ParseDateTime(view, &rec);
  if (status == ParseStatus::kInvalid) {
    // Try with "-01" appended (year-month-only inputs like "2024-03").
    std::string padded(view);
    padded += "-01";
    status = ParseDateTime(padded, &rec);
  }
  if (status != ParseStatus::kOk) {
    return TemporalError::Range("Invalid PlainYearMonth string");
  }
  PlainYearMonth out{};
  out.iso = rec.datetime.iso.date;
  // Spec: day is reference-only; the canonical rep stores 1.
  out.iso.day = 1;
  return out;
}

int32_t PlainYearMonthYear(const PlainYearMonth& self) noexcept {
  return self.iso.year;
}

uint8_t PlainYearMonthMonth(const PlainYearMonth& self) noexcept {
  return self.iso.month;
}

uint8_t PlainYearMonthDaysInMonth(const PlainYearMonth& self) noexcept {
  return ISODaysInMonth(self.iso.year, self.iso.month);
}

bool PlainYearMonthInLeapYear(const PlainYearMonth& self) noexcept {
  return IsLeapYear(self.iso.year);
}

}  // namespace temporal
}  // namespace socketsecurity
}  // namespace node
