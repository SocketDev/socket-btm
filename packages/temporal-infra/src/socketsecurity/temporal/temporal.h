// Public API surface for socketsecurity::temporal.
//
// Hand-written C++ port of the Stage 4 Temporal proposal
// (https://tc39.es/proposal-temporal/), modeled after boa-dev/temporal's
// `temporal_rs` Rust crate.
//
// Architecture (see packages/temporal-infra/README.md):
//   - Calendars delegate to system ICU (icu::Calendar), not a port of
//     icu_calendar. V8 already links ICU.
//   - Timezones delegate to V8's existing js-temporal-zoneinfo64.cc
//     (which reads system tzdata via ICU). No re-implementation.
//   - This port covers the Temporal-specific algorithms only:
//     primitives, ISO arithmetic, parsing, normalization, options,
//     ambiguity resolution.
//
// All types in this header are POD-style values where possible. Methods
// returning fallible results use absl::StatusOr (V8 already vendors
// abseil under deps/v8/third_party/abseil-cpp/).

#ifndef SRC_SOCKETSECURITY_TEMPORAL_TEMPORAL_H_
#define SRC_SOCKETSECURITY_TEMPORAL_TEMPORAL_H_

#include <cstdint>
#include <string>
#include <string_view>

#include "socketsecurity/temporal/temporal_int128.h"

namespace node {
namespace socketsecurity {
namespace temporal {

// ── Primitives ─────────────────────────────────────────────────────

// Temporal.Instant — exact moment in time as nanoseconds since the Unix
// epoch (1970-01-01T00:00:00Z). Calendar-agnostic, timezone-agnostic.
// Maps directly to the spec's `[[Nanoseconds]]` internal slot.
struct Instant {
  Int128 epoch_nanoseconds;

  // Construct from a system clock reading. Wraps V8's system time
  // facilities (v8::base::Time::Now() under the hood).
  static Instant Now() noexcept;

  // Spec: IsValidEpochNanoseconds — within ±10^8 days from epoch.
  bool IsValid() const noexcept;
};

// Temporal.PlainDate — a calendar date with no time-of-day or timezone.
// ISO calendar fields; non-ISO calendars are exposed via the calendar
// binding (see calendar.h, future).
struct PlainDate {
  int32_t iso_year;   // -271821..275760 (ISO 8601 expanded)
  uint8_t iso_month;  // 1..12
  uint8_t iso_day;    // 1..31

  bool IsValid() const noexcept;
};

// Temporal.PlainTime — wall-clock time of day, no date or timezone.
struct PlainTime {
  uint8_t iso_hour;          // 0..23
  uint8_t iso_minute;        // 0..59
  uint8_t iso_second;        // 0..59 (no leap seconds in Temporal)
  uint16_t iso_millisecond;  // 0..999
  uint16_t iso_microsecond;  // 0..999
  uint16_t iso_nanosecond;   // 0..999

  bool IsValid() const noexcept;
};

// Temporal.PlainDateTime — calendar date + wall-clock time, no timezone.
struct PlainDateTime {
  PlainDate date;
  PlainTime time;

  bool IsValid() const noexcept { return date.IsValid() && time.IsValid(); }
};

// ── Duration ──────────────────────────────────────────────────────
//
// Temporal.Duration's `[[*]]` slots. Note that `years`/`months`/`weeks`
// are calendar-aware (different lengths in different calendars), while
// the time-only fields are exact nanosecond multiples. The spec
// distinguishes "balanced" (canonical form) from raw representations.

struct Duration {
  double years;          // Spec uses double; range gated by IsValidDuration.
  double months;
  double weeks;
  double days;
  double hours;
  double minutes;
  double seconds;
  double milliseconds;
  double microseconds;
  double nanoseconds;

  // Spec: IsValidDuration — all components are integers (no NaN/Infinity),
  // signs agree, and the "total nanoseconds" magnitude fits in
  // `Number.MAX_SAFE_INTEGER` for the time-only subset.
  bool IsValid() const noexcept;
};

// ── Arithmetic ─────────────────────────────────────────────────────

// Add a Duration to an Instant. Returns the resulting Instant; if the
// arithmetic overflows the valid Instant range, returns an Instant with
// IsValid() == false (caller decides whether to throw a RangeError).
Instant AddDuration(const Instant& instant, const Duration& duration) noexcept;

// Difference between two instants as a balanced Duration.
Duration InstantSince(const Instant& earlier, const Instant& later) noexcept;

// ── Parsing ────────────────────────────────────────────────────────

// Parse an ISO 8601 / RFC 9557 string into an Instant. Accepts the
// Temporal-extended grammar (annotated calendars, timezones).
// Returns Instant with IsValid() == false on parse error.
Instant ParseInstant(std::string_view input) noexcept;

// ── Formatting ─────────────────────────────────────────────────────

// Format an Instant as an ISO 8601 string with optional precision.
std::string FormatInstant(const Instant& instant) noexcept;

}  // namespace temporal
}  // namespace socketsecurity
}  // namespace node

#endif  // SRC_SOCKETSECURITY_TEMPORAL_TEMPORAL_H_
