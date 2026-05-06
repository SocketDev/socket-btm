// 1:1 port of upstream `src/builtins/core/plain_time.rs` at
// temporal v0.2.3 (c003cc92325e19b26f8ee2f85e4a47d98cbcc781).
//
// `PlainTime` is already declared in temporal.h as the spec-level
// wrapper around IsoTime. This header adds the upstream methods
// (try_new, new_with_overflow, with, add, subtract, since, until,
// round, etc.) plus the `PartialTime` companion struct.

#ifndef SRC_SOCKETSECURITY_TEMPORAL_PLAIN_TIME_H_
#define SRC_SOCKETSECURITY_TEMPORAL_PLAIN_TIME_H_

#include <cstdint>
#include <optional>
#include <string>

#include "socketsecurity/temporal/error.h"
#include "socketsecurity/temporal/temporal.h"

namespace node {
namespace socketsecurity {
namespace temporal {

// Mirror of upstream's `Overflow` enum. Full version with all options
// lands with options.h; for now we expose just Constrain/Reject which
// are the only modes consumed by PlainTime.
enum class Overflow : uint8_t {
  kConstrain,  // default
  kReject,
};

// Mirror of upstream's `PartialTime`. `std::optional` represents the
// "field unset" state (Rust's Option<T>).
struct PartialTime {
  std::optional<uint8_t> hour;
  std::optional<uint8_t> minute;
  std::optional<uint8_t> second;
  std::optional<uint16_t> millisecond;
  std::optional<uint16_t> microsecond;
  std::optional<uint16_t> nanosecond;

  bool IsEmpty() const noexcept {
    return !hour && !minute && !second && !millisecond && !microsecond &&
           !nanosecond;
  }
};

// Free functions on PlainTime. Methods would have required either
// changing PlainTime's POD struct in temporal.h or adding member
// methods, both of which break ABI; free functions namespaced match
// upstream's `impl PlainTime { … }` blocks 1:1 by pairing with the
// type.

// Mirror of upstream's `PlainTime::new` / `try_new` /
// `new_with_overflow`. The first form constrains; the second rejects.
TemporalResult<PlainTime> PlainTimeNew(uint8_t hour, uint8_t minute,
                                        uint8_t second, uint16_t millisecond,
                                        uint16_t microsecond,
                                        uint16_t nanosecond) noexcept;
TemporalResult<PlainTime> PlainTimeTryNew(uint8_t hour, uint8_t minute,
                                           uint8_t second, uint16_t millisecond,
                                           uint16_t microsecond,
                                           uint16_t nanosecond) noexcept;
TemporalResult<PlainTime> PlainTimeNewWithOverflow(
    uint8_t hour, uint8_t minute, uint8_t second, uint16_t millisecond,
    uint16_t microsecond, uint16_t nanosecond, Overflow overflow) noexcept;

// Mirror of upstream's `PlainTime::from_partial`.
TemporalResult<PlainTime> PlainTimeFromPartial(
    const PartialTime& partial,
    std::optional<Overflow> overflow) noexcept;

// Mirror of upstream's `PlainTime::from_utf8`.
TemporalResult<PlainTime> PlainTimeFromUtf8(const uint8_t* data,
                                              size_t length) noexcept;

// Mirror of upstream's `with`. `partial` overrides set fields; unset
// fields fall back to `base`'s values.
TemporalResult<PlainTime> PlainTimeWith(const PlainTime& base,
                                          const PartialTime& partial,
                                          std::optional<Overflow> overflow) noexcept;

// Mirror of upstream's `add` / `subtract`. The Duration type lands in
// temporal.h; full implementation depends on duration.cc's
// add_to_time path.
TemporalResult<PlainTime> PlainTimeAdd(const PlainTime& base,
                                        const Duration& duration) noexcept;
TemporalResult<PlainTime> PlainTimeSubtract(const PlainTime& base,
                                              const Duration& duration) noexcept;

// Mirror of upstream's `until` / `since`. Returns the difference as a
// time-only Duration.
TemporalResult<Duration> PlainTimeUntil(const PlainTime& self,
                                          const PlainTime& other) noexcept;
TemporalResult<Duration> PlainTimeSince(const PlainTime& self,
                                          const PlainTime& other) noexcept;

}  // namespace temporal
}  // namespace socketsecurity
}  // namespace node

#endif  // SRC_SOCKETSECURITY_TEMPORAL_PLAIN_TIME_H_
