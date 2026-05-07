// 1:1 port of upstream `src/parsed_intermediates.rs`.
//
// Lock-step from Rust: parsed_intermediates.rs

#include "socketsecurity/temporal/parsed_intermediates.h"

#include <string_view>

#include "socketsecurity/temporal/calendar.h"
#include "socketsecurity/temporal/parse.h"
#include "socketsecurity/temporal/temporal.h"

namespace node {
namespace socketsecurity {
namespace temporal {

namespace {

TemporalError ErrorFromStatus(ParseStatus status) noexcept {
  switch (status) {
    case ParseStatus::kOk:
      return TemporalError::Generic("Unexpected success in error path");
    case ParseStatus::kInvalid:
      return TemporalError::Range("Invalid IXDTF string");
    case ParseStatus::kUnsupported:
      // Reserved status; the parser doesn't currently produce it, but
      // the switch arm is exhaustive for future-proofing.
      return TemporalError::Range("IXDTF feature not supported");
  }
  return TemporalError::Generic("Unknown parse error");
}

std::string_view AsView(const uint8_t* data, size_t length) noexcept {
  return std::string_view(reinterpret_cast<const char*>(data), length);
}

// Translate a [u-ca=...] annotation captured in ParseDateTimeRecord
// into ParsedDate.calendar_kind. Empty annotation → ISO (0); unknown
// identifier also → ISO (Calendar::TryKindFromUtf8's documented
// behavior is to fall through to kIso on unrecognized input rather
// than reject — matches upstream's lenient parse).
uint8_t CalendarKindFromAnnotation(const char* calendar,
                                    uint8_t calendar_len) noexcept {
  if (calendar_len == 0) {
    return 0;
  }
  auto kind = Calendar::TryKindFromUtf8(
      reinterpret_cast<const uint8_t*>(calendar), calendar_len);
  if (!kind.ok()) {
    return 0;
  }
  return static_cast<uint8_t>(kind.value());
}

}  // namespace

TemporalResult<ParsedDate> ParsedDate::FromUtf8(const uint8_t* data,
                                                  size_t length) noexcept {
  ParseDateTimeRecord rec;
  const ParseStatus status = ParseDateTime(AsView(data, length), &rec);
  if (status != ParseStatus::kOk) {
    return ErrorFromStatus(status);
  }
  ParsedDate out{};
  out.record.year = rec.datetime.iso.date.year;
  out.record.month = rec.datetime.iso.date.month;
  out.record.day = rec.datetime.iso.date.day;
  out.calendar_kind = CalendarKindFromAnnotation(rec.calendar, rec.calendar_len);
  return out;
}

TemporalResult<ParsedDate> ParsedDate::YearMonthFromUtf8(
    const uint8_t* data, size_t length) noexcept {
  ParseDateTimeRecord rec;
  const ParseStatus status = ParseYearMonth(AsView(data, length), &rec);
  if (status != ParseStatus::kOk) {
    return ErrorFromStatus(status);
  }
  ParsedDate out{};
  out.record.year = rec.datetime.iso.date.year;
  out.record.month = rec.datetime.iso.date.month;
  // Day defaults to 0 (the spec uses a reference value here; callers
  // ignore it).
  out.calendar_kind = CalendarKindFromAnnotation(rec.calendar, rec.calendar_len);
  return out;
}

TemporalResult<ParsedDate> ParsedDate::MonthDayFromUtf8(
    const uint8_t* data, size_t length) noexcept {
  ParseDateTimeRecord rec;
  const ParseStatus status = ParseMonthDay(AsView(data, length), &rec);
  if (status != ParseStatus::kOk) {
    return ErrorFromStatus(status);
  }
  ParsedDate out{};
  out.record.month = rec.datetime.iso.date.month;
  out.record.day = rec.datetime.iso.date.day;
  out.calendar_kind = CalendarKindFromAnnotation(rec.calendar, rec.calendar_len);
  return out;
}

TemporalResult<ParsedDateTime> ParsedDateTime::FromUtf8(
    const uint8_t* data, size_t length) noexcept {
  ParseDateTimeRecord rec;
  const ParseStatus status = ParseDateTime(AsView(data, length), &rec);
  if (status != ParseStatus::kOk) {
    return ErrorFromStatus(status);
  }
  ParsedDateTime out{};
  out.date.record.year = rec.datetime.iso.date.year;
  out.date.record.month = rec.datetime.iso.date.month;
  out.date.record.day = rec.datetime.iso.date.day;
  out.date.calendar_kind =
      CalendarKindFromAnnotation(rec.calendar, rec.calendar_len);
  out.time.hour = rec.datetime.iso.time.hour;
  out.time.minute = rec.datetime.iso.time.minute;
  out.time.second = rec.datetime.iso.time.second;
  out.time.millisecond = rec.datetime.iso.time.millisecond;
  out.time.microsecond = rec.datetime.iso.time.microsecond;
  out.time.nanosecond = rec.datetime.iso.time.nanosecond;
  return out;
}

}  // namespace temporal
}  // namespace socketsecurity
}  // namespace node
