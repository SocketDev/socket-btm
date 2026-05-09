// 1:1 port of upstream `src/parsers.rs` IXDTF writer impl section.

#include "socketsecurity/temporal/ixdtf_writer.h"

#include <cstdint>
#include <cstdlib>
#include <string>

namespace node {
namespace socketsecurity {
namespace temporal {

// 1:1 from parsers.rs:196 `write_padded_u8`.
void WritePaddedU8(uint8_t num, std::string& sink) {
  if (num < 10) {
    sink.push_back('0');
  }
  if (num >= 10) {
    sink.push_back(static_cast<char>('0' + (num / 10)));
  }
  sink.push_back(static_cast<char>('0' + (num % 10)));
}

// 1:1 from parsers.rs:216 `u32_to_digits`.
DigitArray9 U32ToDigits(uint32_t value) {
  DigitArray9 out{};
  size_t precision = 0;
  for (int i = 8; i >= 0; --i) {
    uint8_t v = static_cast<uint8_t>(value % 10);
    value /= 10;
    if (precision == 0 && v != 0) {
      precision = static_cast<size_t>(i + 1);
    }
    out.digits[i] = v;
  }
  out.precision_index = precision;
  return out;
}

// 1:1 from parsers.rs:232 `write_digit_slice_to_precision`.
void WriteDigitSliceToPrecision(const uint8_t (&digits)[9], size_t base,
                                 size_t precision, std::string& sink) {
  for (size_t i = base; i < precision; ++i) {
    sink.push_back(static_cast<char>('0' + digits[i]));
  }
}

// 1:1 from parsers.rs:203 `write_nanosecond`.
void WriteNanosecond(uint32_t nanoseconds, Precision precision,
                      std::string& sink) {
  DigitArray9 d = U32ToDigits(nanoseconds);
  size_t prec = d.precision_index;
  if (precision.kind == Precision::Kind::kDigit && precision.digits <= 9) {
    prec = precision.digits;
  }
  WriteDigitSliceToPrecision(d.digits, 0, prec, sink);
}

// 1:1 from parsers.rs:302 `write_four_digit_year` + parsers.rs:315
// `write_extended_year`. Combined under WriteYear (parsers.rs:294).
void WriteYear(int32_t year, std::string& sink) {
  if (year >= 0 && year <= 9999) {
    int32_t y = year;
    sink.push_back(static_cast<char>('0' + (y / 1000)));
    y %= 1000;
    sink.push_back(static_cast<char>('0' + (y / 100)));
    y %= 100;
    sink.push_back(static_cast<char>('0' + (y / 10)));
    y %= 10;
    sink.push_back(static_cast<char>('0' + y));
    return;
  }
  // Extended year: ±NNNNNN (6 digits).
  sink.push_back(year < 0 ? '-' : '+');
  uint32_t abs_y = static_cast<uint32_t>(std::abs(static_cast<int64_t>(year)));
  DigitArray9 d = U32ToDigits(abs_y);
  // Upstream takes digits[3..9] (skip leading 3 digits since the array is
  // right-padded to 9 places and we need exactly 6). 1:1 with parsers.rs:320.
  WriteDigitSliceToPrecision(d.digits, 3, 9, sink);
}

// ── FormattableDate ──────────────────────────────────────────────────
// 1:1 from parsers.rs:278 `impl Writeable for FormattableDate`.
void FormattableDate::WriteTo(std::string& sink) const {
  WriteYear(year, sink);
  sink.push_back('-');
  WritePaddedU8(month, sink);
  sink.push_back('-');
  WritePaddedU8(day, sink);
}

// ── FormattableTime ──────────────────────────────────────────────────
// 1:1 from parsers.rs:126 `impl Writeable for FormattableTime`.
void FormattableTime::WriteTo(std::string& sink) const {
  WritePaddedU8(hour, sink);
  if (include_sep) {
    sink.push_back(':');
  }
  WritePaddedU8(minute, sink);
  if (precision.kind == Precision::Kind::kMinute) {
    return;
  }
  if (include_sep) {
    sink.push_back(':');
  }
  WritePaddedU8(second, sink);
  // Auto + zero ns OR explicit Digit(0) ⇒ no fractional tail.
  const bool digit_zero =
      precision.kind == Precision::Kind::kDigit && precision.digits == 0;
  if ((nanosecond == 0 && precision.kind == Precision::Kind::kAuto) ||
      digit_zero) {
    return;
  }
  sink.push_back('.');
  WriteNanosecond(nanosecond, precision, sink);
}

// ── FormattableOffset ────────────────────────────────────────────────
// 1:1 from parsers.rs:250 `impl Writeable for FormattableOffset`.
void FormattableOffset::WriteTo(std::string& sink) const {
  if (sign == Sign::kNegative) {
    sink.push_back('-');
  } else {
    sink.push_back('+');
  }
  time.WriteTo(sink);
}

// ── FormattableUtcOffset ─────────────────────────────────────────────
// 1:1 from parsers.rs:177 `impl Writeable for FormattableUtcOffset`.
void FormattableUtcOffset::WriteTo(std::string& sink) const {
  if (show == DisplayOffset::kNever) {
    return;
  }
  if (offset.kind == UtcOffsetVariant::Kind::kZ) {
    sink.push_back('Z');
    return;
  }
  offset.offset.WriteTo(sink);
}

// ── FormattableTimeZone ──────────────────────────────────────────────
// 1:1 from parsers.rs:329 `impl Writeable for FormattableTimeZone<'_>`.
void FormattableTimeZone::WriteTo(std::string& sink) const {
  if (show == DisplayTimeZone::kNever) {
    return;
  }
  sink.push_back('[');
  if (show == DisplayTimeZone::kCritical) {
    sink.push_back('!');
  }
  sink.append(timezone);
  sink.push_back(']');
}

// ── FormattableCalendar ──────────────────────────────────────────────
// 1:1 from parsers.rs:357 `impl Writeable for FormattableCalendar<'_>`.
// Note: upstream string-compare is `calendar == "iso8601"`. We mirror.
void FormattableCalendar::WriteTo(std::string& sink) const {
  const bool is_iso8601 = calendar == "iso8601";
  if (show == DisplayCalendar::kNever ||
      (show == DisplayCalendar::kAuto && is_iso8601)) {
    return;
  }
  sink.push_back('[');
  if (show == DisplayCalendar::kCritical) {
    sink.push_back('!');
  }
  sink.append("u-ca=");
  sink.append(calendar);
  sink.push_back(']');
}

// ── FormattableIxdtf ─────────────────────────────────────────────────
// 1:1 from parsers.rs:471 `impl Writeable for FormattableIxdtf<'_>`.
void FormattableIxdtf::WriteTo(std::string& sink) const {
  if (date.has_value()) {
    date->WriteTo(sink);
  }
  if (time.has_value()) {
    if (date.has_value()) {
      sink.push_back('T');
    }
    time->WriteTo(sink);
  }
  if (utc_offset.has_value()) {
    utc_offset->WriteTo(sink);
  }
  if (timezone.has_value()) {
    timezone->WriteTo(sink);
  }
  if (calendar.has_value()) {
    calendar->WriteTo(sink);
  }
}

// ── FormattableMonthDay ──────────────────────────────────────────────
// 1:1 from parsers.rs:390 `impl Writeable for FormattableMonthDay<'_>`.
void FormattableMonthDay::WriteTo(std::string& sink) const {
  const bool show_year =
      calendar.show == DisplayCalendar::kAlways ||
      calendar.show == DisplayCalendar::kCritical || calendar.calendar != "iso8601";
  if (show_year) {
    WriteYear(date.year, sink);
    sink.push_back('-');
  }
  WritePaddedU8(date.month, sink);
  sink.push_back('-');
  WritePaddedU8(date.day, sink);
  calendar.WriteTo(sink);
}

// ── FormattableYearMonth ─────────────────────────────────────────────
// 1:1 from parsers.rs:428 `impl Writeable for FormattableYearMonth<'_>`.
void FormattableYearMonth::WriteTo(std::string& sink) const {
  WriteYear(date.year, sink);
  sink.push_back('-');
  WritePaddedU8(date.month, sink);
  const bool show_day =
      calendar.show == DisplayCalendar::kAlways ||
      calendar.show == DisplayCalendar::kCritical || calendar.calendar != "iso8601";
  if (show_day) {
    sink.push_back('-');
    WritePaddedU8(date.day, sink);
  }
  calendar.WriteTo(sink);
}

}  // namespace temporal
}  // namespace socketsecurity
}  // namespace node
