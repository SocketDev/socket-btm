// 1:1 port of upstream `src/host.rs`.
//
// Lock-step from Rust: host.rs

#include "socketsecurity/temporal/host.h"

#include "socketsecurity/temporal/time_zone.h"

namespace node {
namespace socketsecurity {
namespace temporal {

namespace {
// Singleton UTC TimeZone — pointer returned by GetHostTimeZone matches
// upstream's `Ok(TimeZone::from(UtcOffset::default()))`. Lifetime is
// process-static; safe to hand out a non-owning pointer.
const TimeZone& UtcSingleton() noexcept {
  static const TimeZone instance = TimeZone::Utc();
  return instance;
}
}  // namespace

TemporalResult<int64_t> DefaultEmptyHostSystem::GetHostEpochNanoseconds() {
  // Upstream: `Ok(EpochNanoseconds::from_seconds(0))`. We model
  // EpochNanoseconds as int64_t directly here (see instant.cc).
  return TemporalResult<int64_t>(int64_t{0});
}

TemporalResult<const TimeZone*> DefaultEmptyHostSystem::GetHostTimeZone() {
  // Upstream: `Ok(TimeZone::from(UtcOffset::default()))` — the +00:00
  // zone. We hand back a pointer to the process-static singleton.
  return TemporalResult<const TimeZone*>(&UtcSingleton());
}

}  // namespace temporal
}  // namespace socketsecurity
}  // namespace node
