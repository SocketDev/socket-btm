// ISO 8601 / RFC 9557 hand-rolled recursive-descent parser.

#include "socketsecurity/temporal/parse.h"

#include <cstdint>
#include <cstring>

namespace node {
namespace socketsecurity {
namespace temporal {

namespace {

// Cursor-based reader — pointer + remaining length, with simple
// peek/advance/expect helpers. Avoids std::stringstream overhead.
struct Cursor {
  const char* p;
  size_t n;

  bool Eof() const noexcept { return n == 0; }
  char Peek() const noexcept { return n > 0 ? *p : '\0'; }
  char Get() noexcept {
    if (n == 0) {
      return '\0';
    }
    char c = *p++;
    n--;
    return c;
  }
  bool Consume(char c) noexcept {
    if (n > 0 && *p == c) {
      p++;
      n--;
      return true;
    }
    return false;
  }
  bool ConsumeAny(const char* opts) noexcept {
    if (n == 0) {
      return false;
    }
    for (const char* q = opts; *q; q++) {
      if (*p == *q) {
        p++;
        n--;
        return true;
      }
    }
    return false;
  }
};

// Read exactly `count` ASCII digits into `out`. Returns false on
// non-digit or short input. Used everywhere ISO-style fixed-width
// digit groups are expected (years, months, days, etc.).
bool ReadDigits(Cursor& c, int count, int* out) noexcept {
  if (c.n < static_cast<size_t>(count)) {
    return false;
  }
  int v = 0;
  for (int i = 0; i < count; i++) {
    char ch = c.p[i];
    if (ch < '0' || ch > '9') {
      return false;
    }
    v = v * 10 + (ch - '0');
  }
  c.p += count;
  c.n -= count;
  *out = v;
  return true;
}

// Read up to `max_count` digits, at least 1. Used for fractional
// seconds (1..9 digits per spec). Pads to `pad_to` digits by appending
// zeros, then returns the integer value.
//
// Example: input "5", max=9, pad=9 → returns 500_000_000 (representing
// 0.5 seconds as nanoseconds).
bool ReadFraction(Cursor& c, int max_count, int pad_to, int* out) noexcept {
  if (c.n == 0 || c.p[0] < '0' || c.p[0] > '9') {
    return false;
  }
  int read = 0;
  int v = 0;
  while (read < max_count && c.n > 0 && c.p[0] >= '0' && c.p[0] <= '9') {
    v = v * 10 + (c.p[0] - '0');
    c.p++;
    c.n--;
    read++;
  }
  // Pad to `pad_to` digits.
  for (int i = read; i < pad_to; i++) {
    v *= 10;
  }
  *out = v;
  return true;
}

// Parse the date portion: YYYY-MM-DD or YYYYMMDD. Caller supplies the
// cursor positioned at the start; on success advances past the date.
ParseStatus ParseDateInto(Cursor& c, PlainDate* out) noexcept {
  // TODO(temporal-port): support ±YYYYYY for years outside 0000..9999
  // (spec allows ±271821..275760). Current code rejects > 4-digit years.
  if (c.n > 0 && (c.p[0] == '+' || c.p[0] == '-')) {
    return ParseStatus::kUnsupported;
  }

  int year, month, day;
  if (!ReadDigits(c, 4, &year)) {
    return ParseStatus::kInvalid;
  }
  bool dashed = c.Consume('-');
  if (!ReadDigits(c, 2, &month)) {
    return ParseStatus::kInvalid;
  }
  if (dashed && !c.Consume('-')) {
    return ParseStatus::kInvalid;
  }
  if (!ReadDigits(c, 2, &day)) {
    return ParseStatus::kInvalid;
  }

  out->iso_year = year;
  out->iso_month = static_cast<uint8_t>(month);
  out->iso_day = static_cast<uint8_t>(day);
  if (!out->IsValid()) {
    return ParseStatus::kInvalid;
  }
  return ParseStatus::kOk;
}

// Parse the time portion: HH:MM:SS[.ffffffff] or HHMMSS[.ffffffff].
// Caller supplies cursor positioned at the start; on success advances.
ParseStatus ParseTimeInto(Cursor& c, PlainTime* out) noexcept {
  int hour, minute, second = 0;
  int sub = 0;  // Sub-second fraction in nanoseconds (0..999_999_999).
  if (!ReadDigits(c, 2, &hour)) {
    return ParseStatus::kInvalid;
  }
  bool colon = c.Consume(':');
  if (!ReadDigits(c, 2, &minute)) {
    return ParseStatus::kInvalid;
  }
  // Seconds are optional in the abridged grammar; if present, parse
  // them. Detect by next char being a digit (basic) or ':' (extended).
  if (colon) {
    if (c.Consume(':')) {
      if (!ReadDigits(c, 2, &second)) {
        return ParseStatus::kInvalid;
      }
    }
  } else if (c.n >= 2 && c.p[0] >= '0' && c.p[0] <= '9') {
    if (!ReadDigits(c, 2, &second)) {
      return ParseStatus::kInvalid;
    }
  }
  // Optional fractional seconds.
  if (c.Consume('.') || c.Consume(',')) {
    if (!ReadFraction(c, 9, 9, &sub)) {
      return ParseStatus::kInvalid;
    }
  }

  out->iso_hour = static_cast<uint8_t>(hour);
  out->iso_minute = static_cast<uint8_t>(minute);
  out->iso_second = static_cast<uint8_t>(second);
  out->iso_millisecond = static_cast<uint16_t>(sub / 1000000);
  out->iso_microsecond = static_cast<uint16_t>((sub / 1000) % 1000);
  out->iso_nanosecond = static_cast<uint16_t>(sub % 1000);
  if (!out->IsValid()) {
    return ParseStatus::kInvalid;
  }
  return ParseStatus::kOk;
}

// Parse a UTC offset suffix: Z, ±HH, ±HHMM, ±HH:MM. Returns the
// offset in nanoseconds. Caller passes `has_offset` out-param to
// distinguish "offsetless input" from "+00:00".
ParseStatus ParseOffsetInto(Cursor& c, int64_t* out_ns,
                            bool* has_offset) noexcept {
  if (c.Eof()) {
    *has_offset = false;
    *out_ns = 0;
    return ParseStatus::kOk;
  }
  char first = c.Peek();
  if (first == 'Z' || first == 'z') {
    c.Get();
    *has_offset = true;
    *out_ns = 0;
    return ParseStatus::kOk;
  }
  if (first != '+' && first != '-') {
    *has_offset = false;
    *out_ns = 0;
    return ParseStatus::kOk;
  }
  int sign = (first == '+') ? 1 : -1;
  c.Get();

  int hh, mm = 0, ss = 0;
  if (!ReadDigits(c, 2, &hh)) {
    return ParseStatus::kInvalid;
  }
  bool colon = c.Consume(':');
  if (c.n >= 2 && c.p[0] >= '0' && c.p[0] <= '9') {
    if (!ReadDigits(c, 2, &mm)) {
      return ParseStatus::kInvalid;
    }
    if (colon && c.Consume(':')) {
      if (!ReadDigits(c, 2, &ss)) {
        return ParseStatus::kInvalid;
      }
    } else if (!colon && c.n >= 2 && c.p[0] >= '0' && c.p[0] <= '9') {
      if (!ReadDigits(c, 2, &ss)) {
        return ParseStatus::kInvalid;
      }
    }
  }

  // TODO(temporal-port): fractional second in offset is rejected here;
  // the spec permits ±HH:MM:SS.fff for legacy POSIX timezones with
  // sub-second offsets. Few real timezones use this; defer.
  if (c.Consume('.') || c.Consume(',')) {
    return ParseStatus::kUnsupported;
  }

  if (hh > 23 || mm > 59 || ss > 59) {
    return ParseStatus::kInvalid;
  }
  int64_t total_seconds = static_cast<int64_t>(hh) * 3600 +
                          static_cast<int64_t>(mm) * 60 + ss;
  *out_ns = sign * total_seconds * 1'000'000'000LL;
  *has_offset = true;
  return ParseStatus::kOk;
}

}  // namespace

ParseStatus ParseDate(std::string_view input, PlainDate* out) noexcept {
  Cursor c{input.data(), input.size()};
  ParseStatus s = ParseDateInto(c, out);
  if (s != ParseStatus::kOk) {
    return s;
  }
  if (!c.Eof()) {
    return ParseStatus::kInvalid;
  }
  return ParseStatus::kOk;
}

ParseStatus ParseDateTime(std::string_view input,
                          ParsedDateTime* out) noexcept {
  Cursor c{input.data(), input.size()};
  ParseStatus s = ParseDateInto(c, &out->datetime.date);
  if (s != ParseStatus::kOk) {
    return s;
  }
  // 'T' or ' ' (space, per RFC 3339 §5.6) separator — the spec
  // canonicalizes on T but accepts both.
  if (!c.Eof()) {
    if (c.Peek() == 'T' || c.Peek() == 't' || c.Peek() == ' ') {
      c.Get();
      s = ParseTimeInto(c, &out->datetime.time);
      if (s != ParseStatus::kOk) {
        return s;
      }
    } else {
      // No time component: zero-fill.
      out->datetime.time = PlainTime{};
    }
  } else {
    out->datetime.time = PlainTime{};
  }
  // Optional UTC offset.
  s = ParseOffsetInto(c, &out->offset_nanoseconds, &out->has_offset);
  if (s != ParseStatus::kOk) {
    return s;
  }
  // TODO(temporal-port): RFC 9557 calendar/timezone annotations
  // [u-ca=…] / [Etc/UTC] / [!America/New_York]. Reject for now so
  // callers can detect "valid grammar but extension unsupported."
  if (!c.Eof() && c.Peek() == '[') {
    return ParseStatus::kUnsupported;
  }
  if (!c.Eof()) {
    return ParseStatus::kInvalid;
  }
  return ParseStatus::kOk;
}

ParseStatus ParseInstantString(std::string_view input,
                               Instant* out) noexcept {
  ParsedDateTime parsed{};
  ParseStatus s = ParseDateTime(input, &parsed);
  if (s != ParseStatus::kOk) {
    return s;
  }
  if (!parsed.has_offset) {
    // Spec: TemporalInstantString requires offset.
    return ParseStatus::kInvalid;
  }
  // Compute epoch nanoseconds. Convert PlainDateTime → JDN (via the
  // helper in iso.cc) → days-since-epoch → nanoseconds, then subtract
  // the offset.
  //
  // KISS: do it directly here without re-exposing ToJDN, since this
  // is the only call site outside iso.cc.
  const PlainDate& d = parsed.datetime.date;
  int32_t a = (14 - d.iso_month) / 12;
  int32_t y = d.iso_year + 4800 - a;
  int32_t m = d.iso_month + 12 * a - 3;
  int64_t jdn = static_cast<int64_t>(d.iso_day) + (153 * m + 2) / 5 +
                365LL * y + y / 4 - y / 100 + y / 400 - 32045;
  // JDN of 1970-01-01 = 2440588.
  int64_t days_since_epoch = jdn - 2440588;
  // Time-of-day in nanoseconds.
  const PlainTime& t = parsed.datetime.time;
  int64_t tod_ns = (static_cast<int64_t>(t.iso_hour) * 3600 +
                    static_cast<int64_t>(t.iso_minute) * 60 +
                    t.iso_second) *
                       1'000'000'000LL +
                   static_cast<int64_t>(t.iso_millisecond) * 1'000'000 +
                   static_cast<int64_t>(t.iso_microsecond) * 1'000 +
                   t.iso_nanosecond;
  // Days × 86_400 × 1e9 needs int128 to avoid overflow at the extremes.
  NativeInt128 day_ns = static_cast<NativeInt128>(days_since_epoch) *
                        NativeInt128{86'400'000'000'000LL};
  NativeInt128 epoch_ns = day_ns + NativeInt128{tod_ns} -
                          NativeInt128{parsed.offset_nanoseconds};
  out->epoch_nanoseconds = Int128(epoch_ns);
  if (!out->IsValid()) {
    return ParseStatus::kInvalid;
  }
  return ParseStatus::kOk;
}

}  // namespace temporal
}  // namespace socketsecurity
}  // namespace node
