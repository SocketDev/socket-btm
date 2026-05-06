// 1:1 port of upstream `src/builtins/core/plain_time.rs`.

#include "socketsecurity/temporal/plain_time.h"

#include <string_view>

#include "socketsecurity/temporal/parse.h"

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
  // ParseDateTime handles time-only inputs ("T12:00:00") by zero-filling
  // the date part. Reject Z/offset (PlainTime::from_str rejects those).
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

TemporalResult<PlainTime> PlainTimeAdd(const PlainTime& /*base*/,
                                        const Duration& /*duration*/) noexcept {
  // Upstream's add_to_time uses IsoTime::balance which depends on the
  // full duration normalization stack (TimeDuration). Stub for now;
  // full impl lands when duration normalization ports.
  return TemporalError::Generic("PlainTime::Add not yet ported");
}

TemporalResult<PlainTime> PlainTimeSubtract(const PlainTime& /*base*/,
                                              const Duration& /*duration*/) noexcept {
  return TemporalError::Generic("PlainTime::Subtract not yet ported");
}

TemporalResult<Duration> PlainTimeUntil(const PlainTime& /*self*/,
                                          const PlainTime& /*other*/) noexcept {
  return TemporalError::Generic("PlainTime::Until not yet ported");
}

TemporalResult<Duration> PlainTimeSince(const PlainTime& /*self*/,
                                          const PlainTime& /*other*/) noexcept {
  return TemporalError::Generic("PlainTime::Since not yet ported");
}

}  // namespace temporal
}  // namespace socketsecurity
}  // namespace node
