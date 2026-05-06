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
// Coverage status:
//   ✓ DateSpec: YYYY-MM-DD, YYYYMMDD
//   ✓ TimeSpec: HH:MM:SS, HH:MM:SS.fff, HHMMSS
//   ✓ DateTime: <DateSpec>T<TimeSpec>
//   ✓ UTC offsets: Z, ±HH, ±HHMM, ±HH:MM
//   ✓ Sub-second precision: 1..9 fractional digits
//   ☐ Calendar annotations: [u-ca=iso8601], [!u-ca=…]   (TODO)
//   ☐ Timezone annotations: [Etc/UTC], [!America/New_York]  (TODO)
//   ☐ Year ±YYYYYY (>4 digit, signed)              (TODO)
//
// Unimplemented productions return ParseStatus::kUnsupported with a
// pointer to where parsing stopped. Callers can fall back or surface
// to the user.

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
  kUnsupported,  // Valid grammar, but not yet implemented (e.g. calendar
                 // annotation [u-ca=hebrew]). See TODOs in parse.cc.
};

struct ParsedDateTime {
  PlainDateTime datetime;
  // UTC offset in nanoseconds. Set by Z (=0) or ±HH:MM (=offset). When
  // input has no offset annotation, has_offset == false.
  int64_t offset_nanoseconds;
  bool has_offset;
};

// Parse an ISO 8601 / RFC 9557 string into PlainDateTime + optional
// offset. Whitespace-trimming is the caller's responsibility.
ParseStatus ParseDateTime(std::string_view input, ParsedDateTime* out) noexcept;

// Parse an Instant (point-in-time) string into nanoseconds since epoch.
// Requires a UTC offset (Z or ±HH:MM); rejects offsetless input per
// spec's TemporalInstantString grammar.
ParseStatus ParseInstantString(std::string_view input, Instant* out) noexcept;

// Parse just a date (no time/offset). Accepts YYYY-MM-DD or YYYYMMDD.
ParseStatus ParseDate(std::string_view input, PlainDate* out) noexcept;

}  // namespace temporal
}  // namespace socketsecurity
}  // namespace node

#endif  // SRC_SOCKETSECURITY_TEMPORAL_PARSE_H_
