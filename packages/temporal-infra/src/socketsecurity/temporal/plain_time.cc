// 1:1 port of upstream `src/builtins/core/plain_time.rs`.

#include "socketsecurity/temporal/plain_time.h"

#include <string_view>

#include "socketsecurity/temporal/duration_normalized.h"
#include "socketsecurity/temporal/iso.h"
#include "socketsecurity/temporal/parse.h"
#include "socketsecurity/temporal/utils.h"

namespace node {
namespace socketsecurity {
namespace temporal {

namespace {

// Helper: build an IsoTime with overflow handling. Mirrors upstream's
// `IsoTime::new(hour, minute, second, ms, us, ns, overflow)`.
TemporalResult<IsoTime> IsoTimeNew(uint8_t hour, uint8_t minute,
                                     uint8_t second, uint16_t millisecond,
                                     uint16_t microsecond, uint16_t nanosecond,
                                     Overflow overflow) noexcept {
  IsoTime t{hour, minute, second, millisecond, microsecond, nanosecond};
  if (t.IsValid()) {
    return t;
  }
  if (overflow == Overflow::kReject) {
    return TemporalError::Range("Time component out of range");
  }
  // Constrain: clamp each field. Upstream does the same.
  IsoTime out;
  out.hour = (hour > 23) ? 23 : hour;
  out.minute = (minute > 59) ? 59 : minute;
  out.second = (second > 59) ? 59 : second;
  out.millisecond = (millisecond > 999) ? 999 : millisecond;
  out.microsecond = (microsecond > 999) ? 999 : microsecond;
  out.nanosecond = (nanosecond > 999) ? 999 : nanosecond;
  return out;
}

}  // namespace

TemporalResult<PlainTime> PlainTimeNew(uint8_t hour, uint8_t minute,
                                        uint8_t second, uint16_t millisecond,
                                        uint16_t microsecond,
                                        uint16_t nanosecond) noexcept {
  return PlainTimeNewWithOverflow(hour, minute, second, millisecond,
                                  microsecond, nanosecond,
                                  Overflow::kConstrain);
}

TemporalResult<PlainTime> PlainTimeTryNew(uint8_t hour, uint8_t minute,
                                           uint8_t second, uint16_t millisecond,
                                           uint16_t microsecond,
                                           uint16_t nanosecond) noexcept {
  return PlainTimeNewWithOverflow(hour, minute, second, millisecond,
                                  microsecond, nanosecond,
                                  Overflow::kReject);
}

TemporalResult<PlainTime> PlainTimeNewWithOverflow(
    uint8_t hour, uint8_t minute, uint8_t second, uint16_t millisecond,
    uint16_t microsecond, uint16_t nanosecond, Overflow overflow) noexcept {
  auto iso = IsoTimeNew(hour, minute, second, millisecond, microsecond,
                        nanosecond, overflow);
  if (!iso.ok()) {
    return iso.error();
  }
  PlainTime pt{};
  pt.iso = iso.value();
  return pt;
}

TemporalResult<PlainTime> PlainTimeFromPartial(
    const PartialTime& partial,
    std::optional<Overflow> overflow) noexcept {
  // Upstream: PartialTime cannot be empty (one field must be set).
  if (partial.IsEmpty()) {
    return TemporalError::Type("PartialTime cannot be empty.");
  }
  const Overflow ov = overflow.value_or(Overflow::kConstrain);
  return PlainTimeNewWithOverflow(partial.hour.value_or(0),
                                  partial.minute.value_or(0),
                                  partial.second.value_or(0),
                                  partial.millisecond.value_or(0),
                                  partial.microsecond.value_or(0),
                                  partial.nanosecond.value_or(0), ov);
}

TemporalResult<PlainTime> PlainTimeFromUtf8(const uint8_t* data,
                                              size_t length) noexcept {
  PlainTime pt{};
  std::string_view view(reinterpret_cast<const char*>(data), length);
  // Two accepted forms:
  //   1. Time-only: "12:34:56" / "12:34:56.789" / "T12:34:56"
  //   2. Full DateTime where ParseDateTime extracts the time part:
  //      "2026-05-08T12:34:56", "2026-05-08 12:34:56"
  //
  // ParseTimeOnly handles the bare-time form (with optional 'T'
  // prefix). ParseDateTime requires a leading date so isolated time
  // strings would fail without the dedicated entry point.
  if (ParseTimeOnly(view, &pt) == ParseStatus::kOk) {
    return pt;
  }
  pt = PlainTime{};
  ParseDateTimeRecord rec;
  const ParseStatus status = ParseDateTime(view, &rec);
  if (status != ParseStatus::kOk) {
    return TemporalError::Range("Invalid PlainTime string");
  }
  // Per upstream tests, time-with-UTC-designator is invalid.
  if (rec.has_offset) {
    return TemporalError::Range(
        "PlainTime string must not contain a UTC offset");
  }
  pt.iso = rec.datetime.iso.time;
  return pt;
}

TemporalResult<PlainTime> PlainTimeWith(const PlainTime& base,
                                          const PartialTime& partial,
                                          std::optional<Overflow> overflow) noexcept {
  if (partial.IsEmpty()) {
    return TemporalError::Type("PartialTime cannot be empty.");
  }
  const Overflow ov = overflow.value_or(Overflow::kConstrain);
  return PlainTimeNewWithOverflow(
      partial.hour.value_or(base.iso.hour),
      partial.minute.value_or(base.iso.minute),
      partial.second.value_or(base.iso.second),
      partial.millisecond.value_or(base.iso.millisecond),
      partial.microsecond.value_or(base.iso.microsecond),
      partial.nanosecond.value_or(base.iso.nanosecond), ov);
}

namespace {

// Upstream's `PlainTime::add_to_time(duration)`: delegates to
// IsoTime::balance with each duration component summed into the
// corresponding time component. Returns the balanced time (and discards
// the day overflow — IsoTime::balance is total).
TemporalResult<PlainTime> AddToTime(const PlainTime& base,
                                      const Duration& duration) noexcept {
  // Saturate-add each integer component (matches Rust's saturating_add).
  // Doubles get truncated toward zero — the spec validates duration as
  // integer-valued before reaching here, so any fractional part is a
  // caller bug.
  auto sat = [](double v) -> int64_t {
    if (v >= static_cast<double>(INT64_MAX)) return INT64_MAX;
    if (v <= static_cast<double>(INT64_MIN)) return INT64_MIN;
    return static_cast<int64_t>(v);
  };
  const int64_t hour = static_cast<int64_t>(base.iso.hour) + sat(duration.hours);
  const int64_t minute = static_cast<int64_t>(base.iso.minute) +
                          sat(duration.minutes);
  const int64_t second = static_cast<int64_t>(base.iso.second) +
                          sat(duration.seconds);
  const int64_t milli = static_cast<int64_t>(base.iso.millisecond) +
                         sat(duration.milliseconds);
  const int64_t micro = static_cast<int64_t>(base.iso.microsecond) +
                         sat(duration.microseconds);
  const int64_t nano = static_cast<int64_t>(base.iso.nanosecond) +
                        sat(duration.nanoseconds);
  auto balanced = BalanceIsoTime(hour, minute, second, milli, micro, nano);
  PlainTime out{};
  out.iso = balanced.time;
  return out;
}

// Negate each Duration component. Mirror upstream's `Duration::negated`.
Duration NegateDuration(const Duration& d) noexcept {
  Duration out = d;
  out.years = -out.years;
  out.months = -out.months;
  out.weeks = -out.weeks;
  out.days = -out.days;
  out.hours = -out.hours;
  out.minutes = -out.minutes;
  out.seconds = -out.seconds;
  out.milliseconds = -out.milliseconds;
  out.microseconds = -out.microseconds;
  out.nanoseconds = -out.nanoseconds;
  return out;
}

// DiffTime: emit a time-only Duration from two PlainTimes via the
// TimeDuration pipeline. Upstream: `PlainTime::diff_time(op, other,
// settings)` — we expose Until / Since as the public surface.
TemporalResult<Duration> DiffTime(const PlainTime& self,
                                    const PlainTime& other,
                                    bool since) noexcept {
  // Build the raw (other - self) as a TimeDuration, then split back
  // into hours/minutes/.../nanoseconds components using floor division.
  TimeDuration delta = DiffIsoTime(self.iso, other.iso);
  Int128 ns = delta.Nanoseconds();
  if (since) {
    ns = -ns;
  }
  // Upstream's Duration::from_internal balances at the largest unit.
  // For PlainTime::until/since the largestUnit defaults to `hour`,
  // smallestUnit to `nanosecond`, with no rounding. Decompose ns into
  // (h, m, s, ms, us, ns_remainder).
  bool negative = ns < Int128(0);
  Int128 abs_ns = negative ? -ns : ns;

  const Int128 ns_per_hour(static_cast<int64_t>(kNsPerHour));
  const Int128 ns_per_min(static_cast<int64_t>(kNsPerMinute));
  const Int128 ns_per_sec(static_cast<int64_t>(kNsPerSecond));
  const Int128 ns_per_milli(static_cast<int64_t>(kNsPerMillisecond));
  const Int128 ns_per_micro(static_cast<int64_t>(kNsPerMicrosecond));

  Int128 hours = abs_ns / ns_per_hour;
  Int128 r = abs_ns % ns_per_hour;
  Int128 minutes = r / ns_per_min;
  r = r % ns_per_min;
  Int128 secs = r / ns_per_sec;
  r = r % ns_per_sec;
  Int128 millis = r / ns_per_milli;
  r = r % ns_per_milli;
  Int128 micros = r / ns_per_micro;
  r = r % ns_per_micro;
  Int128 nanos = r;

  Duration out{};
  const double sign = negative ? -1.0 : 1.0;
  out.hours = sign * static_cast<double>(hours.ToInt64());
  out.minutes = sign * static_cast<double>(minutes.ToInt64());
  out.seconds = sign * static_cast<double>(secs.ToInt64());
  out.milliseconds = sign * static_cast<double>(millis.ToInt64());
  out.microseconds = sign * static_cast<double>(micros.ToInt64());
  out.nanoseconds = sign * static_cast<double>(nanos.ToInt64());
  return out;
}

}  // namespace

TemporalResult<PlainTime> PlainTimeAdd(const PlainTime& base,
                                        const Duration& duration) noexcept {
  return AddToTime(base, duration);
}

TemporalResult<PlainTime> PlainTimeSubtract(const PlainTime& base,
                                              const Duration& duration) noexcept {
  return AddToTime(base, NegateDuration(duration));
}

TemporalResult<Duration> PlainTimeUntil(const PlainTime& self,
                                          const PlainTime& other) noexcept {
  return DiffTime(self, other, /*since=*/false);
}

TemporalResult<Duration> PlainTimeSince(const PlainTime& self,
                                          const PlainTime& other) noexcept {
  return DiffTime(self, other, /*since=*/true);
}

TemporalResult<PlainTime> PlainTimeRound(
    const PlainTime& self, const RoundingOptions& options) noexcept {
  auto resolved = ResolvedRoundingOptionsFromTime(options);
  if (!resolved.ok()) {
    return resolved.error();
  }
  auto r = RoundIsoTime(self.iso, resolved.value());
  if (!r.ok()) {
    return r.error();
  }
  PlainTime out{};
  out.iso = r.value().time;
  return out;
}

}  // namespace temporal
}  // namespace socketsecurity
}  // namespace node
