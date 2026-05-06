// 1:1 port of upstream `src/host.rs`.

#include "socketsecurity/temporal/host.h"

namespace node {
namespace socketsecurity {
namespace temporal {

TemporalResult<int64_t> DefaultEmptyHostSystem::GetHostEpochNanoseconds() {
  // Upstream: `Ok(EpochNanoseconds::from_seconds(0))`. We model
  // EpochNanoseconds as int64_t directly here (see instant.cc).
  return TemporalResult<int64_t>(int64_t{0});
}

TemporalResult<const TimeZone*> DefaultEmptyHostSystem::GetHostTimeZone() {
  // Upstream returns `TimeZone::from(UtcOffset::default())`, which is
  // the +00:00 zone. The TimeZone class isn't ported yet; for now we
  // surface a placeholder error so callers can detect the unported
  // dependency. Once time_zone.cc lands, return `&TimeZone::UTC()`.
  return TemporalError::Generic("TimeZone not yet ported");
}

}  // namespace temporal
}  // namespace socketsecurity
}  // namespace node
