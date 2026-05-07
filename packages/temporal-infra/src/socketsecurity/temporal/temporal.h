// Public API surface for socketsecurity::temporal.
//
// 1:1 hand-written C++ port of the Stage 4 Temporal proposal
// (https://tc39.es/proposal-temporal/), modeled after boa-dev/temporal's
// `temporal_rs` Rust crate at v0.2.3.
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
// Naming follows upstream 1:1 to keep the port verifiable. Where Rust
// uses snake_case, C++ uses snake_case for fields (matches upstream)
// and PascalCase for methods (Google C++ style). Spec-level types
// (IsoDate, IsoTime, IsoDateTime) are bare structs without a Calendar;
// `PlainDate` etc. wrap them with a calendar identifier.

#ifndef SRC_SOCKETSECURITY_TEMPORAL_TEMPORAL_H_
#define SRC_SOCKETSECURITY_TEMPORAL_TEMPORAL_H_

#include <cstdint>
#include <string>
#include <string_view>

#include "socketsecurity/temporal/temporal_int128.h"

namespace node {
namespace socketsecurity {
namespace temporal {

// Forward declarations for free functions defined in duration.cc that
// take or return TemporalError / Sign / TemporalResult<Duration>.
enum class Sign : int8_t;            // duration_normalized.h
struct TemporalError;                // error.h
template <typename T>
class TemporalResult;                // error.h

// ── Spec-level ISO records ────────────────────────────────────────────
//
// These mirror upstream's `IsoDate` / `IsoTime` / `IsoDateTime` (in
// `src/iso.rs`). They have no calendar attached — the spec uses them as
// the Gregorian-only representation that calendar algorithms normalize
// to before doing arithmetic.

// Mirror of upstream's `IsoDate { year, month, day }`.
struct IsoDate {
  int32_t year;   // -271821..275760 (ISO 8601 expanded)
  uint8_t month;  // 1..12
  uint8_t day;    // 1..31

  // Spec: IsValidISODate
  bool IsValid() const noexcept;

  // The Unix epoch sentinel — used by callers like
  // `PlainTime::epoch_ns_for_utc()` (upstream's UNIX_EPOCH constant).
  static constexpr IsoDate UnixEpoch() noexcept {
    return IsoDate{1970, 1, 1};
  }
};

// Mirror of upstream's `IsoTime { hour, minute, second, millisecond,
// microsecond, nanosecond }`.
struct IsoTime {
  uint8_t hour;          // 0..23
  uint8_t minute;        // 0..59
  uint8_t second;        // 0..59 (no leap seconds in Temporal)
  uint16_t millisecond;  // 0..999
  uint16_t microsecond;  // 0..999
  uint16_t nanosecond;   // 0..999

  // Spec: IsValidISOTime
  bool IsValid() const noexcept;
};

// Mirror of upstream's `IsoDateTime { date, time }`.
struct IsoDateTime {
  IsoDate date;
  IsoTime time;

  bool IsValid() const noexcept { return date.IsValid() && time.IsValid(); }
};

// ── Calendar-aware wrappers ───────────────────────────────────────────
//
// These mirror upstream's `PlainDate { iso, calendar }` etc. The C++
// PODs intentionally hold only the `iso` slot; the `Calendar` value
// (when non-ISO) is carried alongside by the V8 binding (which puts
// it in a separate Object slot in JSTemporalPlainDate / etc.). This
// keeps the temporal-infra structs trivially copyable and ABI-stable.

class Calendar;  // Defined in calendar.h.

// Temporal.PlainDate — a calendar date with no time-of-day or timezone.
// The calendar slot is intentionally omitted from this POD struct;
// callers wanting calendar-aware semantics carry a `Calendar` value
// alongside the IsoDate (matches V8's `JSTemporalPlainDate` layout
// where calendar is a separate Object slot). Canonical home: this
// header; plain_date.h adds methods/helpers but does NOT redefine.
struct PlainDate {
  IsoDate iso;

  bool IsValid() const noexcept { return iso.IsValid(); }
};

// Temporal.PlainTime — wall-clock time of day, no date or timezone.
// Canonical home: this header; plain_time.h adds methods/helpers.
struct PlainTime {
  IsoTime iso;

  bool IsValid() const noexcept { return iso.IsValid(); }
};

// Temporal.PlainDateTime — calendar date + wall-clock time, no timezone.
// Canonical home: this header; plain_date_time.h adds methods/helpers.
struct PlainDateTime {
  IsoDateTime iso;

  bool IsValid() const noexcept { return iso.IsValid(); }
};

// ── Instant ───────────────────────────────────────────────────────────

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

// Mirror of upstream's `Duration::new` / `Duration::try_new` / display
// surface. These are the public spec methods exposed by V8's
// js-temporal-objects.cc when constructing or inspecting a Duration.

// Spec: CreateTemporalDuration — bypasses IsValidDuration, intended for
// callers that have already verified the components.
Duration DurationCreate(int64_t years, int64_t months, int64_t weeks,
                         int64_t days, int64_t hours, int64_t minutes,
                         int64_t seconds, int64_t milliseconds,
                         double microseconds, double nanoseconds) noexcept;

// Spec: Duration::TryNew — validates via IsValidDuration before
// constructing.
TemporalResult<Duration> DurationTryNew(int64_t years, int64_t months,
                                         int64_t weeks, int64_t days,
                                         int64_t hours, int64_t minutes,
                                         int64_t seconds, int64_t milliseconds,
                                         double microseconds,
                                         double nanoseconds) noexcept;

// Spec: DurationSign — discriminates the duration's overall sign.
Sign DurationGetSign(const Duration& d) noexcept;
bool DurationIsZero(const Duration& d) noexcept;

// Spec: Duration.prototype.abs / negated.
Duration DurationAbs(const Duration& d) noexcept;
Duration DurationNegated(const Duration& d) noexcept;

// Spec: IsTimeWithinRange — accessor used by the time-component balance
// algorithm.
bool DurationIsTimeWithinRange(const Duration& d) noexcept;

// Spec: Duration.prototype.add / subtract — without relativeTo, only
// the time-portion path is supported.
TemporalResult<Duration> DurationAdd(const Duration& self,
                                      const Duration& other) noexcept;
TemporalResult<Duration> DurationSubtract(const Duration& self,
                                           const Duration& other) noexcept;

// Spec: ParseTemporalDurationString.
TemporalResult<Duration> DurationFromUtf8(std::string_view input) noexcept;

// Spec: TemporalDurationToString — canonical IXDTF without rounding.
std::string DurationToString(const Duration& d) noexcept;

// Spec: TotalDurationNanoseconds — time-portion sum as a double.
double DurationTotalNanoseconds(const Duration& d) noexcept;

// Spec: CompareDurations (time-only path; rejects calendar components
// without a relativeTo anchor).
TemporalResult<int8_t> DurationCompare(const Duration& a,
                                         const Duration& b) noexcept;

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
