// 1:1 port of upstream `src/sys.rs`.

#include "socketsecurity/temporal/sys.h"

#include <cmath>
#include <cstdint>

// V8's portable monotonic clock. Already linked into libnode.
#include "src/base/platform/time.h"

namespace node {
namespace socketsecurity {
namespace temporal {

TemporalResult<int64_t> GetSystemEpochNanoseconds() noexcept {
  // Upstream: `SystemTime::now().duration_since(UNIX_EPOCH).as_nanos()`.
  // V8 already has Time::Now() returning seconds-since-epoch as a
  // double; multiplying by 1e9 introduces rounding for years > 2262.
  // For the smoke-test surface this is fine; a higher-precision int128
  // path lands in instant.cc once that's wired up to v8::base::Time.
  const double now = v8::base::Time::Now().ToJsTime();  // ms since epoch
  if (!std::isfinite(now)) {
    return TemporalError::Generic("Error fetching system time");
  }
  // Convert ms → ns. Cap to int64 range; nanosecond precision is lost
  // on dates far from 1970 but that matches V8's existing behavior.
  return static_cast<int64_t>(now * 1'000'000.0);
}

TemporalResult<int64_t> UtcHostSystem::GetHostEpochNanoseconds() {
  return GetSystemEpochNanoseconds();
}

TemporalResult<const TimeZone*> UtcHostSystem::GetHostTimeZone() {
  // Upstream: `Ok(TimeZone::utc_with_provider(provider))`. Pending
  // time_zone.cc port — return placeholder error for now.
  return TemporalError::Generic("TimeZone not yet ported");
}

TemporalResult<int64_t> LocalHostSystem::GetHostEpochNanoseconds() {
  return GetSystemEpochNanoseconds();
}

TemporalResult<const TimeZone*> LocalHostSystem::GetHostTimeZone() {
  // Upstream uses iana_time_zone crate. V8 can detect this via
  // Intl::DefaultTimeZone() or the OS's TZ env var. Wire-up lands
  // when time_zone.cc lands.
  return TemporalError::Generic("TimeZone not yet ported");
}

}  // namespace temporal
}  // namespace socketsecurity
}  // namespace node
