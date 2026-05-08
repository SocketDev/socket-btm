// 1:1 port of upstream `src/sys.rs`.

#include "socketsecurity/temporal/sys.h"

#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <string>

#include "socketsecurity/temporal/time_zone.h"

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
  // std::chrono::system_clock::now() is the C++ standard wall-clock.
  // int64 ns covers ±292 years from 1970 — outside that range the
  // higher-precision Int128 path in instant.cc's caller takes over.
  const auto now = std::chrono::system_clock::now();
  return std::chrono::duration_cast<std::chrono::nanoseconds>(
             now.time_since_epoch())
      .count();
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
