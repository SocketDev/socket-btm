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

// Parse the date portion: YYYY-MM-DD, YYYYMMDD, or ±YYYYYY-MM-DD
// (signed expanded year, exactly six digits per spec).
ParseStatus ParseDateInto(Cursor& c, PlainDate* out) noexcept {
  int year_digits = 4;
  int sign = 1;
  if (c.n > 0 && (c.p[0] == '+' || c.p[0] == '-')) {
    sign = (c.p[0] == '+') ? 1 : -1;
    c.Get();
    year_digits = 6;  // Spec: signed expanded years are exactly 6 digits.
  }
  int year, month, day;
  if (!ReadDigits(c, year_digits, &year)) {
    return ParseStatus::kInvalid;
  }
  // Spec: -000000 (i.e. signed -0 year) is forbidden.
  if (sign == -1 && year == 0) {
    return ParseStatus::kInvalid;
  }
  year = sign * year;
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

  out->iso.year = year;
  out->iso.month = static_cast<uint8_t>(month);
  out->iso.day = static_cast<uint8_t>(day);
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

  out->iso.hour = static_cast<uint8_t>(hour);
  out->iso.minute = static_cast<uint8_t>(minute);
  out->iso.second = static_cast<uint8_t>(second);
  out->iso.millisecond = static_cast<uint16_t>(sub / 1000000);
  out->iso.microsecond = static_cast<uint16_t>((sub / 1000) % 1000);
  out->iso.nanosecond = static_cast<uint16_t>(sub % 1000);
  if (!out->IsValid()) {
    return ParseStatus::kInvalid;
  }
  return ParseStatus::kOk;
}

// Parse a UTC offset suffix per RFC 9557. Sets:
//   *out_ns       — offset in nanoseconds.
//   *has_offset   — true if any offset (Z or numeric) was consumed.
//   *is_utc_z     — true iff the suffix was 'Z' / 'z'.
//   *has_seconds  — true if the offset specified seconds (rules out
//                   match-minutes per spec).
ParseStatus ParseOffsetInto(Cursor& c, int64_t* out_ns, bool* has_offset,
                            bool* is_utc_z, bool* has_seconds) noexcept {
  *has_offset = false;
  *out_ns = 0;
  *is_utc_z = false;
  *has_seconds = false;
  if (c.Eof()) {
    return ParseStatus::kOk;
  }
  char first = c.Peek();
  if (first == 'Z' || first == 'z') {
    c.Get();
    *has_offset = true;
    *is_utc_z = true;
    return ParseStatus::kOk;
  }
  if (first != '+' && first != '-') {
    return ParseStatus::kOk;
  }
  int sign = (first == '+') ? 1 : -1;
  c.Get();

  int hh, mm = 0, ss = 0;
  if (!ReadDigits(c, 2, &hh)) {
    return ParseStatus::kInvalid;
  }
  bool colon = c.Consume(':');
  bool got_minutes = false;
  if (c.n >= 2 && c.p[0] >= '0' && c.p[0] <= '9') {
    if (!ReadDigits(c, 2, &mm)) {
      return ParseStatus::kInvalid;
    }
    got_minutes = true;
    if (colon && c.Consume(':')) {
      if (!ReadDigits(c, 2, &ss)) {
        return ParseStatus::kInvalid;
      }
      *has_seconds = true;
    } else if (!colon && c.n >= 2 && c.p[0] >= '0' && c.p[0] <= '9') {
      if (!ReadDigits(c, 2, &ss)) {
        return ParseStatus::kInvalid;
      }
      *has_seconds = true;
    }
  }
  // Sub-second fraction in offset (e.g. legacy POSIX timezones).
  int frac_ns = 0;
  if (*has_seconds && (c.Consume('.') || c.Consume(','))) {
    if (!ReadFraction(c, 9, 9, &frac_ns)) {
      return ParseStatus::kInvalid;
    }
  }

  if (hh > 23 || mm > 59 || ss > 59) {
    return ParseStatus::kInvalid;
  }
  (void)got_minutes;  // mm = 0 default is fine when minute-less is allowed.
  int64_t total_ns =
      (static_cast<int64_t>(hh) * 3600 + static_cast<int64_t>(mm) * 60 + ss) *
      1'000'000'000LL +
      static_cast<int64_t>(frac_ns);
  *out_ns = sign * total_ns;
  *has_offset = true;
  return ParseStatus::kOk;
}

// Parse a single RFC 9557 annotation `[!?content]` into the caller's
// buffer. On entry the cursor sits at '['. On success advances past
// the matching ']'.
ParseStatus ParseAnnotationInto(Cursor& c, char* buffer, uint8_t buf_size,
                                  uint8_t* out_len, bool* out_critical) noexcept {
  if (!c.Consume('[')) {
    return ParseStatus::kInvalid;
  }
  *out_critical = c.Consume('!');
  *out_len = 0;
  while (!c.Eof() && c.Peek() != ']') {
    if (*out_len >= buf_size) {
      return ParseStatus::kInvalid;
    }
    buffer[*out_len] = c.Get();
    (*out_len)++;
  }
  if (!c.Consume(']')) {
    return ParseStatus::kInvalid;
  }
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
                          ParseDateTimeRecord* out) noexcept {
  Cursor c{input.data(), input.size()};
  // ParseDateInto/ParseTimeInto take PlainDate*/PlainTime* (which
  // wrap an IsoDate/IsoTime). Build temporary wrappers, then copy the
  // inner records into out->datetime.iso.{date,time}.
  PlainDate pd{};
  ParseStatus s = ParseDateInto(c, &pd);
  if (s != ParseStatus::kOk) {
    return s;
  }
  out->datetime.iso.date = pd.iso;
  // 'T' or ' ' (space, per RFC 3339 §5.6) separator — the spec
  // canonicalizes on T but accepts both.
  PlainTime pt{};
  if (!c.Eof()) {
    if (c.Peek() == 'T' || c.Peek() == 't' || c.Peek() == ' ') {
      c.Get();
      s = ParseTimeInto(c, &pt);
      if (s != ParseStatus::kOk) {
        return s;
      }
    }
    // else: zero IsoTime (default-constructed pt).
  }
  out->datetime.iso.time = pt.iso;
  // Optional UTC offset.
  s = ParseOffsetInto(c, &out->offset_nanoseconds, &out->has_offset,
                       &out->offset_is_utc_designator,
                       &out->offset_has_seconds);
  if (s != ParseStatus::kOk) {
    return s;
  }
  // RFC 9557 annotations: at most one [TimeZone] (the first '['
  // annotation that doesn't start with `u-ca=`) and any number of
  // `[u-ca=...]` calendar annotations. Per the spec, if multiple
  // calendar annotations appear, the *first* without `!` wins; a `!`
  // in any of them makes the embedder reject if it can't honor the
  // calendar. For simplicity we capture the first calendar and the
  // first time-zone we encounter and ignore duplicates (matches
  // upstream's `ixdtf` behavior).
  out->calendar_len = 0;
  out->calendar_critical = false;
  out->time_zone_len = 0;
  out->time_zone_critical = false;
  while (!c.Eof() && c.Peek() == '[') {
    char buf[kMaxAnnotationLen];
    uint8_t buf_len = 0;
    bool critical = false;
    s = ParseAnnotationInto(c, buf, kMaxAnnotationLen, &buf_len, &critical);
    if (s != ParseStatus::kOk) {
      return s;
    }
    // Detect "u-ca=..." prefix (case-sensitive per RFC 9557).
    const bool is_calendar = buf_len >= 5 && buf[0] == 'u' && buf[1] == '-' &&
                              buf[2] == 'c' && buf[3] == 'a' && buf[4] == '=';
    if (is_calendar) {
      // Take the first non-critical calendar (or any critical).
      if (out->calendar_len == 0 || critical) {
        const uint8_t cal_len = buf_len - 5;
        for (uint8_t i = 0; i < cal_len; ++i) {
          out->calendar[i] = buf[5 + i];
        }
        out->calendar_len = cal_len;
        out->calendar_critical = critical;
      }
    } else {
      // First time-zone annotation; later ones are ignored per spec
      // (multiple [TimeZone] annotations are a syntax error in IXDTF
      // — we leave that strict enforcement to a future pass).
      if (out->time_zone_len == 0) {
        for (uint8_t i = 0; i < buf_len; ++i) {
          out->time_zone[i] = buf[i];
        }
        out->time_zone_len = buf_len;
        out->time_zone_critical = critical;
      }
    }
  }
  if (!c.Eof()) {
    return ParseStatus::kInvalid;
  }
  return ParseStatus::kOk;
}

ParseStatus ParseInstantString(std::string_view input,
                               Instant* out) noexcept {
  ParseDateTimeRecord parsed{};
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
  const IsoDate& d = parsed.datetime.iso.date;
  int32_t a = (14 - d.month) / 12;
  int32_t y = d.year + 4800 - a;
  int32_t m = d.month + 12 * a - 3;
  int64_t jdn = static_cast<int64_t>(d.day) + (153 * m + 2) / 5 +
                365LL * y + y / 4 - y / 100 + y / 400 - 32045;
  // JDN of 1970-01-01 = 2440588.
  int64_t days_since_epoch = jdn - 2440588;
  // Time-of-day in nanoseconds.
  const IsoTime& t = parsed.datetime.iso.time;
  int64_t tod_ns = (static_cast<int64_t>(t.hour) * 3600 +
                    static_cast<int64_t>(t.minute) * 60 +
                    t.second) *
                       1'000'000'000LL +
                   static_cast<int64_t>(t.millisecond) * 1'000'000 +
                   static_cast<int64_t>(t.microsecond) * 1'000 +
                   t.nanosecond;
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

ParseStatus ParseYearMonth(std::string_view input,
                            ParseDateTimeRecord* out) noexcept {
  // Try the bare YYYY-MM / YYYYMM grammars first (zero day → reference
  // value 1). Both forms can be followed by trailing annotations.
  Cursor c{input.data(), input.size()};
  *out = ParseDateTimeRecord{};
  int sign = 1;
  int year_digits = 4;
  if (c.n > 0 && (c.p[0] == '+' || c.p[0] == '-')) {
    sign = (c.p[0] == '+') ? 1 : -1;
    c.Get();
    year_digits = 6;
  }
  int year, month;
  if (!ReadDigits(c, year_digits, &year)) {
    return ParseStatus::kInvalid;
  }
  if (sign == -1 && year == 0) {
    return ParseStatus::kInvalid;
  }
  year *= sign;
  c.Consume('-');  // optional separator
  if (!ReadDigits(c, 2, &month)) {
    return ParseStatus::kInvalid;
  }
  // Bare YYYY-MM accepted? If the cursor now sits at end-of-input or
  // an annotation '[', this is a YearMonth string; otherwise we
  // fall through to ParseDateTime (which handles full DateTime
  // strings whose date part is interpreted as YearMonth+ref-day).
  if (c.Eof() || c.Peek() == '[') {
    if (month < 1 || month > 12) {
      return ParseStatus::kInvalid;
    }
    out->datetime.iso.date.year = year;
    out->datetime.iso.date.month = static_cast<uint8_t>(month);
    out->datetime.iso.date.day = 1;  // reference value
    // Parse trailing annotations.
    while (!c.Eof() && c.Peek() == '[') {
      char buf[kMaxAnnotationLen];
      uint8_t buf_len = 0;
      bool critical = false;
      ParseStatus s =
          ParseAnnotationInto(c, buf, kMaxAnnotationLen, &buf_len, &critical);
      if (s != ParseStatus::kOk) {
        return s;
      }
      const bool is_calendar = buf_len >= 5 && buf[0] == 'u' &&
                                buf[1] == '-' && buf[2] == 'c' &&
                                buf[3] == 'a' && buf[4] == '=';
      if (is_calendar && (out->calendar_len == 0 || critical)) {
        const uint8_t cal_len = buf_len - 5;
        for (uint8_t i = 0; i < cal_len; ++i) {
          out->calendar[i] = buf[5 + i];
        }
        out->calendar_len = cal_len;
        out->calendar_critical = critical;
      } else if (!is_calendar && out->time_zone_len == 0) {
        for (uint8_t i = 0; i < buf_len; ++i) {
          out->time_zone[i] = buf[i];
        }
        out->time_zone_len = buf_len;
        out->time_zone_critical = critical;
      }
    }
    if (!c.Eof()) {
      return ParseStatus::kInvalid;
    }
    return ParseStatus::kOk;
  }
  // Not a bare YearMonth — full DateTime path.
  return ParseDateTime(input, out);
}

ParseStatus ParseMonthDay(std::string_view input,
                           ParseDateTimeRecord* out) noexcept {
  // Spec grammar: `--MM-DD`, `MMDD`, `MM-DD`. We additionally accept
  // full DateTime strings whose date part is interpreted as MonthDay
  // (matches upstream's flexible accept).
  Cursor c{input.data(), input.size()};
  *out = ParseDateTimeRecord{};
  // Optional `--` prefix.
  bool double_dash = false;
  if (c.n >= 2 && c.p[0] == '-' && c.p[1] == '-') {
    c.Get();
    c.Get();
    double_dash = true;
  }
  // Try MMDD or MM-DD.
  Cursor save = c;
  int month, day;
  bool ok = ReadDigits(c, 2, &month);
  if (ok) {
    bool dashed = c.Consume('-');
    if (!ReadDigits(c, 2, &day)) {
      ok = false;
    } else if (!dashed && !c.Eof() && c.Peek() != '[') {
      // 4-digit MMDD must end here (or be followed by an annotation).
      // Otherwise this is a full DateTime — rewind.
      ok = false;
    }
  }
  if (ok && (c.Eof() || c.Peek() == '[')) {
    if (month < 1 || month > 12) {
      return ParseStatus::kInvalid;
    }
    if (day < 1 || day > 31) {
      return ParseStatus::kInvalid;
    }
    out->datetime.iso.date.year = 1972;  // reference value (leap year)
    out->datetime.iso.date.month = static_cast<uint8_t>(month);
    out->datetime.iso.date.day = static_cast<uint8_t>(day);
    while (!c.Eof() && c.Peek() == '[') {
      char buf[kMaxAnnotationLen];
      uint8_t buf_len = 0;
      bool critical = false;
      ParseStatus s =
          ParseAnnotationInto(c, buf, kMaxAnnotationLen, &buf_len, &critical);
      if (s != ParseStatus::kOk) {
        return s;
      }
      const bool is_calendar = buf_len >= 5 && buf[0] == 'u' &&
                                buf[1] == '-' && buf[2] == 'c' &&
                                buf[3] == 'a' && buf[4] == '=';
      if (is_calendar && (out->calendar_len == 0 || critical)) {
        const uint8_t cal_len = buf_len - 5;
        for (uint8_t i = 0; i < cal_len; ++i) {
          out->calendar[i] = buf[5 + i];
        }
        out->calendar_len = cal_len;
        out->calendar_critical = critical;
      } else if (!is_calendar && out->time_zone_len == 0) {
        for (uint8_t i = 0; i < buf_len; ++i) {
          out->time_zone[i] = buf[i];
        }
        out->time_zone_len = buf_len;
        out->time_zone_critical = critical;
      }
    }
    if (!c.Eof()) {
      return ParseStatus::kInvalid;
    }
    return ParseStatus::kOk;
  }
  if (double_dash) {
    // The `--` prefix is *only* valid before the bare MM-DD form.
    return ParseStatus::kInvalid;
  }
  // Rewind and try ParseDateTime — full DateTime input where the
  // date portion is interpreted as MonthDay+reference-year.
  (void)save;
  return ParseDateTime(input, out);
}

}  // namespace temporal
}  // namespace socketsecurity
}  // namespace node
