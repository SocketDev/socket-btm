// Temporal.Instant — exact moment in time as nanoseconds since the Unix
// epoch. Calendar/timezone-agnostic.
//
// V8 already exposes a 100-nanosecond-precision system clock via
// v8::base::Time::Now(); we widen to nanoseconds (the spec's precision)
// by reading microseconds and extending. For higher precision on
// platforms that have it (Linux clock_gettime CLOCK_REALTIME, macOS
// mach_absolute_time, Windows GetSystemTimePreciseAsFileTime), V8's
// internal time facilities already do the right thing — we use what V8
// gives us rather than calling the syscalls ourselves.

#include "socketsecurity/temporal/temporal.h"

#include "socketsecurity/temporal/temporal_int128.h"

// V8 base time facilities — already linked into every Node binary.
// Reach into V8's headers via the same path patterns node-smol's other
// additions use (src/socketsecurity/* sources include "v8.h",
// "node.h", and V8 internal headers via the deps/v8/include/ path
// the gyp build sets up).
#include "src/base/platform/time.h"

namespace node {
namespace socketsecurity {
namespace temporal {

// ── Construction ───────────────────────────────────────────────────

Instant Instant::Now() noexcept {
  // v8::base::Time::Now() returns microseconds since the Unix epoch as
  // a v8::base::Time. We extract the raw int64 microseconds and widen
  // to nanoseconds. The factor-of-1000 multiplication can't overflow
  // int128 within any plausible date range.
  const int64_t us = v8::base::Time::Now().ToInternalValue();
  // V8's "internal value" is microseconds-since-epoch on POSIX and
  // Windows alike (see deps/v8/src/base/platform/time.h). Convert by
  // multiplying by 1000 to get nanoseconds.
  const NativeInt128 ns = static_cast<NativeInt128>(us) * NativeInt128{1000};
  return Instant{Int128(ns)};
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

// ── PlainDate / PlainTime / PlainDateTime ──────────────────────────
//
// Stub implementations — the IsValid() checks are mechanical range
// validations. Calendar arithmetic comes in a later commit (the file
// for that is calendar.cc; future).

bool PlainDate::IsValid() const noexcept {
  // Spec: IsValidISODate(year, month, day)
  // Year range: -271821..275760 (per spec: math allows ±10^8 days from
  // epoch ≈ ±273_972 years, narrowed to spec's ±271821/+275760).
  if (iso_year < -271821 || iso_year > 275760) {
    return false;
  }
  if (iso_month < 1 || iso_month > 12) {
    return false;
  }
  if (iso_day < 1 || iso_day > 31) {
    return false;
  }
  // Per-month day count + leap year checks land with the calendar
  // binding (calendar.cc, future). For now this is the cheap shape
  // check; a 31-day check on Feb still passes here, gets caught
  // downstream when arithmetic constructs an actual date.
  return true;
}

bool PlainTime::IsValid() const noexcept {
  // Spec: IsValidTime(hour, minute, second, ms, us, ns)
  // Note: Temporal explicitly omits leap seconds, so second is 0..59.
  if (iso_hour > 23) {
    return false;
  }
  if (iso_minute > 59) {
    return false;
  }
  if (iso_second > 59) {
    return false;
  }
  if (iso_millisecond > 999) {
    return false;
  }
  if (iso_microsecond > 999) {
    return false;
  }
  if (iso_nanosecond > 999) {
    return false;
  }
  return true;
}

}  // namespace temporal
}  // namespace socketsecurity
}  // namespace node
