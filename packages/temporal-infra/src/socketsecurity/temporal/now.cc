// 1:1 port of upstream `src/builtins/core/now.rs`.

#include "socketsecurity/temporal/now.h"

namespace node {
namespace socketsecurity {
namespace temporal {

TemporalResult<Instant> Now::InstantNow() {
  // Upstream: `Ok(Instant::from(self.host_hooks.get_system_epoch_nanoseconds()?))`
  auto ns = hooks_->GetSystemEpochNanoseconds();
  if (!ns.ok()) {
    return ns.error();
  }
  // Pending instant.cc public ctor — bind once Instant exposes a
  // ns-accepting constructor.
  return TemporalError::Generic("Instant::FromEpochNs not yet ported");
}

TemporalResult<TimeZone> Now::TimeZoneWithProvider() {
  // Upstream: `self.host_hooks.get_system_time_zone(provider)`. Returns
  // a TimeZone by value; in C++ that requires the full TimeZone class.
  return TemporalError::Generic("TimeZone not yet ported");
}

TemporalResult<ZonedDateTime> Now::ZonedDateTimeIsoWithProvider(
    const TimeZone* /*tz_or_null*/) {
  return TemporalError::Generic("ZonedDateTime not yet ported");
}

TemporalResult<PlainDateTime> Now::PlainDateTimeIsoWithProvider(
    const TimeZone* /*tz_or_null*/) {
  return TemporalError::Generic("PlainDateTime not yet ported");
}

TemporalResult<PlainDate> Now::PlainDateIsoWithProvider(
    const TimeZone* /*tz_or_null*/) {
  return TemporalError::Generic("PlainDate not yet ported");
}

TemporalResult<PlainTime> Now::PlainTimeIsoWithProvider(
    const TimeZone* /*tz_or_null*/) {
  return TemporalError::Generic("PlainTime not yet ported");
}

}  // namespace temporal
}  // namespace socketsecurity
}  // namespace node
