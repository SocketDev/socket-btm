// 1:1 port of upstream `src/builtins/core/now.rs` at temporal v0.2.3
// (c003cc92325e19b26f8ee2f85e4a47d98cbcc781).
//
// Lock-step from Rust: builtins/core/now.rs
//
// Rust's `Now<H>` is parameterized over the HostHooks trait. C++ takes a
// `HostHooks*` (non-owning) — same flexibility, ABI-stable.

#ifndef SRC_SOCKETSECURITY_TEMPORAL_NOW_H_
#define SRC_SOCKETSECURITY_TEMPORAL_NOW_H_

#include "socketsecurity/temporal/error.h"
#include "socketsecurity/temporal/host.h"

namespace node {
namespace socketsecurity {
namespace temporal {

// Forward decls — concrete classes land in their own .cc files.
class Instant;
class PlainDate;
class PlainDateTime;
class PlainTime;
class TimeZone;
class ZonedDateTime;

// Mirror of upstream's `Now<H: HostHooks>`. The hooks pointer is
// non-owning; lifetime managed by the caller.
class Now {
 public:
  explicit Now(HostHooks* hooks) noexcept : hooks_(hooks) {}

  // 1:1 with upstream methods.
  TemporalResult<Instant> InstantNow();
  TemporalResult<TimeZone> TimeZoneWithProvider();
  TemporalResult<ZonedDateTime> ZonedDateTimeIsoWithProvider(
      const TimeZone* tz_or_null);
  TemporalResult<PlainDateTime> PlainDateTimeIsoWithProvider(
      const TimeZone* tz_or_null);
  TemporalResult<PlainDate> PlainDateIsoWithProvider(
      const TimeZone* tz_or_null);
  TemporalResult<PlainTime> PlainTimeIsoWithProvider(
      const TimeZone* tz_or_null);

 private:
  HostHooks* hooks_;
};

}  // namespace temporal
}  // namespace socketsecurity
}  // namespace node

#endif  // SRC_SOCKETSECURITY_TEMPORAL_NOW_H_
