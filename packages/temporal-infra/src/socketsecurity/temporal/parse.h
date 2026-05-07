// ISO 8601 / RFC 9557 / Temporal-extended parser.
//
// Spec grammar:
//   https://tc39.es/proposal-temporal/#sec-temporal-iso8601-grammar
//   RFC 9557: https://datatracker.ietf.org/doc/html/rfc9557
//
// Implementation note: this is a hand-rolled recursive-descent parser
// rather than a port of `ixdtf` (boa-dev/temporal's parser crate). The
// grammar is small enough (~80 productions, ~30 of which are common
// shapes) that a 1k-LOC C++ parser is cleaner than ~5k LOC of
// generated FFI bindings to a Rust parser. KISS over reuse here.
//
// Coverage:
//   ✓ DateSpec: YYYY-MM-DD, YYYYMMDD, ±YYYYYY-MM-DD (signed expanded year)
//   ✓ TimeSpec: HH:MM:SS, HH:MM:SS.fff, HHMMSS
//   ✓ DateTime: <DateSpec>T<TimeSpec>
//   ✓ UTC offsets: Z, ±HH, ±HHMM, ±HH:MM, ±HH:MM:SS, ±HH:MM:SS.fff
//   ✓ Sub-second precision: 1..9 fractional digits
//   ✓ Calendar annotations: [u-ca=iso8601], [!u-ca=hebrew]
//   ✓ Timezone annotations: [Etc/UTC], [!America/New_York], [+05:30]

#ifndef SRC_SOCKETSECURITY_TEMPORAL_PARSE_H_
#define SRC_SOCKETSECURITY_TEMPORAL_PARSE_H_

#include <cstdint>
#include <string_view>

#include "socketsecurity/temporal/temporal.h"

namespace node {
namespace socketsecurity {
namespace temporal {

enum class ParseStatus : uint8_t {
  kOk,
  kInvalid,      // Syntactically wrong (e.g. "2026-13-45")
  kUnsupported,  // Reserved for grammar variants unsupported by this
                 // parser (currently none — full RFC 9557 coverage).
};

// Maximum lengths for the calendar / time-zone annotation strings
// embedded in IXDTF input. The spec doesn't bound these in the
// grammar, but real values are short (longest IANA zone is
// "America/Argentina/ComodRivadavia" at 32 bytes; longest calendar
// id is "ethiopic-amete-alem" at 19 bytes). 64 bytes is generous
// for both and lets the record stay POD.
constexpr size_t kMaxAnnotationLen = 64;

// Parser-level output. Distinct from upstream's spec-level
// `ParsedDateTime` (in parsed_intermediates.h) which represents the
// pre-validate intermediate after full IXDTF parsing.
struct ParseDateTimeRecord {
  PlainDateTime datetime;
  // UTC offset in nanoseconds. Set by Z (=0) or ±HH:MM (=offset). When
  // input has no offset annotation, has_offset == false.
  int64_t offset_nanoseconds;
  bool has_offset;
  // True when the offset was a UTC designator ('Z' or 'z'); distinct
  // from explicit "+00:00" because the spec disambiguation differs.
  bool offset_is_utc_designator;
  // Sub-minute precision flag: true if the offset record contains
  // seconds (e.g. ±HH:MM:SS). Mirrors upstream's `match_minutes`.
  bool offset_has_seconds;

  // Calendar annotation. Empty when none present. `calendar_critical`
  // tracks the `!` prefix per RFC 9557.
  char calendar[kMaxAnnotationLen];
  uint8_t calendar_len;
  bool calendar_critical;

  // Time-zone annotation. Empty when none present. `time_zone_critical`
  // tracks the `!` prefix.
  char time_zone[kMaxAnnotationLen];
  uint8_t time_zone_len;
  bool time_zone_critical;
};

// Parse an ISO 8601 / RFC 9557 string into PlainDateTime + optional
// offset. Whitespace-trimming is the caller's responsibility.
ParseStatus ParseDateTime(std::string_view input,
                          ParseDateTimeRecord* out) noexcept;

// Parse an Instant (point-in-time) string into nanoseconds since epoch.
// Requires a UTC offset (Z or ±HH:MM); rejects offsetless input per
// spec's TemporalInstantString grammar.
ParseStatus ParseInstantString(std::string_view input, Instant* out) noexcept;

// Parse just a date (no time/offset). Accepts YYYY-MM-DD or YYYYMMDD.
ParseStatus ParseDate(std::string_view input, PlainDate* out) noexcept;

// Parse a YearMonth string (TemporalYearMonthString). Accepts the
// bare YYYY-MM / YYYYMM forms as well as full TemporalDateTimeString
// inputs (where the day component is treated as a reference value).
// Optional [u-ca=...] calendar annotation is preserved in `*out` via
// the same record shape as ParseDateTime.
ParseStatus ParseYearMonth(std::string_view input,
                            ParseDateTimeRecord* out) noexcept;

// Parse a MonthDay string (TemporalMonthDayString). Accepts the bare
// `--MM-DD` / `MM-DD` / `MMDD` forms as well as full
// TemporalDateTimeString inputs (where the year is a reference value
// — upstream uses 1972).
ParseStatus ParseMonthDay(std::string_view input,
                           ParseDateTimeRecord* out) noexcept;

}  // namespace temporal
}  // namespace socketsecurity
}  // namespace node

#endif  // SRC_SOCKETSECURITY_TEMPORAL_PARSE_H_
