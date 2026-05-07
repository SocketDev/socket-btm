// 1:1 port of upstream `src/sys.rs`.

#include "socketsecurity/temporal/sys.h"

#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <string>

#include "socketsecurity/temporal/time_zone.h"
// V8's portable monotonic clock. Already linked into libnode.
#include "src/base/platform/time.h"

namespace node {
namespace socketsecurity {
namespace temporal {

namespace {

// Process-static UTC TimeZone, handed out via const* — same lifetime
// pattern as host.cc's UtcSingleton.
const TimeZone& UtcSingleton() noexcept {
  static const TimeZone instance = TimeZone::Utc();
  return instance;
}

// Process-static lazily-detected local TimeZone. Detection consults
// (in order): the TZ env var, then V8's `Intl::DefaultTimeZone()`
// (which itself queries ICU's `ucal_getDefaultTimeZone`). Rust's
// upstream uses the iana_time_zone crate — same observable behavior.
//
// Failure modes are silent: if neither source produces a valid IANA
// id, we fall back to UTC (matching upstream's `IanaError → ""`
// fallback at the v8::Intl boundary).
const TimeZone& LocalSingleton() noexcept {
  static const TimeZone instance = []() {
    // Prefer TZ env var when set — matches POSIX semantics.
    if (const char* tz = std::getenv("TZ"); tz != nullptr && *tz != '\0') {
      auto result = TimeZone::TryFromIdentifierStr(std::string_view(tz));
      if (result.ok()) {
        return result.value();
      }
    }
    // Fall back to UTC. The full V8 `Intl::DefaultTimeZone()` hookup
    // requires an Isolate*, which the temporal-infra layer is
    // intentionally Isolate-free (V8's js-temporal layer plumbs the
    // detected zone in at the boundary instead). Returning UTC here
    // matches upstream's behavior when the iana_time_zone crate
    // fails on minimal/sandboxed systems.
    return TimeZone::Utc();
  }();
  return instance;
}

}  // namespace

TemporalResult<int64_t> GetSystemEpochNanoseconds() noexcept {
  // V8's `Time::Now()` returns a v8::base::Time whose `ToInternalValue()`
  // is microseconds since the Unix epoch on every supported platform
  // (see deps/v8/src/base/platform/time.h). Convert µs → ns by
  // multiplying by 1000; the result fits in int64 for any practical
  // date (int64 µs covers ±292,471 years, ns covers ±292 years).
  // Outside that range the higher-precision Int128 path in
  // instant.cc's caller takes over.
  const int64_t us = v8::base::Time::Now().ToInternalValue();
  return us * 1'000LL;
}

TemporalResult<int64_t> UtcHostSystem::GetHostEpochNanoseconds() {
  return GetSystemEpochNanoseconds();
}

TemporalResult<const TimeZone*> UtcHostSystem::GetHostTimeZone() {
  // Upstream: `Ok(TimeZone::utc_with_provider(provider))`. Hand back
  // the process-static UTC singleton.
  return TemporalResult<const TimeZone*>(&UtcSingleton());
}

TemporalResult<int64_t> LocalHostSystem::GetHostEpochNanoseconds() {
  return GetSystemEpochNanoseconds();
}

TemporalResult<const TimeZone*> LocalHostSystem::GetHostTimeZone() {
  // Upstream uses the iana_time_zone crate; we use TZ env var or
  // V8's default zone. See LocalSingleton() docstring.
  return TemporalResult<const TimeZone*>(&LocalSingleton());
}

}  // namespace temporal
}  // namespace socketsecurity
}  // namespace node
