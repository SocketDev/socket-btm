// Temporal.Instant — exact moment in time as nanoseconds since the Unix
// epoch. Calendar/timezone-agnostic.

#include "socketsecurity/temporal/temporal.h"

#include <chrono>

#include "socketsecurity/temporal/temporal_int128.h"

namespace node {
namespace socketsecurity {
namespace temporal {

// ── Construction ───────────────────────────────────────────────────

Instant Instant::Now() noexcept {
  // std::chrono::system_clock::now() returns a system-wall-clock
  // time_point. Converting to ns since the Unix epoch is portable on
  // every supported platform and avoids reaching into V8 internals.
  const auto now = std::chrono::system_clock::now();
  const int64_t ns_since_epoch =
      std::chrono::duration_cast<std::chrono::nanoseconds>(
          now.time_since_epoch())
          .count();
  return Instant{Int128(static_cast<NativeInt128>(ns_since_epoch))};
}

// ── Validation ─────────────────────────────────────────────────────

bool Instant::IsValid() const noexcept {
  // Spec: IsValidEpochNanoseconds(epochNanoseconds)
  //   1. If epochNanoseconds < nsMinInstant or epochNanoseconds > nsMaxInstant,
  //      return false.
  //   2. Return true.
  //
  // nsMaxInstant = 8.64 × 10^21 ns (= 10^8 days × 86400 × 10^9 ns/day)
  // nsMinInstant = -nsMaxInstant
  //
  // Centralized in kMaxInstantNanoseconds() so we don't recompute it
  // on every call.
  const Int128 max = kMaxInstantNanoseconds();
  const Int128 zero;
  const Int128 min = zero - max;
  return epoch_nanoseconds >= min && epoch_nanoseconds <= max;
}

// ── IsoDate / IsoTime ──────────────────────────────────────────────
//
// Spec validation for the bare ISO records. PlainDate/PlainTime/
// PlainDateTime delegate to these via their `iso` field.

bool IsoDate::IsValid() const noexcept {
  // Spec: IsValidISODate(year, month, day)
  // Year range: -271821..275760 (per spec: math allows ±10^8 days from
  // epoch ≈ ±273_972 years, narrowed to spec's ±271821/+275760).
  if (year < -271821 || year > 275760) {
    return false;
  }
  if (month < 1 || month > 12) {
    return false;
  }
  if (day < 1 || day > 31) {
    return false;
  }
  // Per-month day count + leap year checks land with the calendar
  // binding (calendar.cc, future). For now this is the cheap shape
  // check; a 31-day check on Feb still passes here, gets caught
  // downstream when arithmetic constructs an actual date.
  return true;
}

bool IsoTime::IsValid() const noexcept {
  // Spec: IsValidTime(hour, minute, second, ms, us, ns)
  // Note: Temporal explicitly omits leap seconds, so second is 0..59.
  if (hour > 23) {
    return false;
  }
  if (minute > 59) {
    return false;
  }
  if (second > 59) {
    return false;
  }
  if (millisecond > 999) {
    return false;
  }
  if (microsecond > 999) {
    return false;
  }
  if (nanosecond > 999) {
    return false;
  }
  return true;
}

// ── Arithmetic ─────────────────────────────────────────────────────

// Spec 8.5.10: AddDurationToInstant(operation, instant, duration).
// Caller validates that the duration has no calendar components
// (years/months/weeks); we sum the time components into total ns and
// add to the instant's epoch_nanoseconds in 128-bit space. The
// resulting Instant is checked via IsValid() at the call site.
Instant AddDuration(const Instant& instant, const Duration& duration) noexcept {
  // Sum time components in nanoseconds (int128 to handle the full
  // range of representable Durations without precision loss). Days are
  // included per spec for time-only path; calendar components must
  // already be zero (caller's responsibility).
  constexpr NativeInt128 kNsPerUs = 1000;
  constexpr NativeInt128 kNsPerMs = 1000 * kNsPerUs;
  constexpr NativeInt128 kNsPerSec = 1000 * kNsPerMs;
  constexpr NativeInt128 kNsPerMin = 60 * kNsPerSec;
  constexpr NativeInt128 kNsPerHour = 60 * kNsPerMin;
  constexpr NativeInt128 kNsPerDay = 24 * kNsPerHour;

  NativeInt128 total = 0;
  total += static_cast<NativeInt128>(duration.days) * kNsPerDay;
  total += static_cast<NativeInt128>(duration.hours) * kNsPerHour;
  total += static_cast<NativeInt128>(duration.minutes) * kNsPerMin;
  total += static_cast<NativeInt128>(duration.seconds) * kNsPerSec;
  total += static_cast<NativeInt128>(duration.milliseconds) * kNsPerMs;
  total += static_cast<NativeInt128>(duration.microseconds) * kNsPerUs;
  total += static_cast<NativeInt128>(duration.nanoseconds);

  return Instant{Int128(instant.epoch_nanoseconds.value + total)};
}

}  // namespace temporal
}  // namespace socketsecurity
}  // namespace node
