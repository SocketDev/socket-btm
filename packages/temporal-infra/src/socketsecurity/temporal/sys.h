// 1:1 port of upstream `src/sys.rs` at temporal v0.2.3
// (c003cc92325e19b26f8ee2f85e4a47d98cbcc781).
//
// Lock-step from Rust: sys.rs
//
// Rust gates Local/Utc host systems behind cargo features (sys, sys-local).
// The C++ port unconditionally provides the UTC variant (no system
// dependency) and exposes a hook for V8's existing IANA detection in the
// local variant. Both inherit from HostHooks.

#ifndef SRC_SOCKETSECURITY_TEMPORAL_SYS_H_
#define SRC_SOCKETSECURITY_TEMPORAL_SYS_H_

#include "socketsecurity/temporal/host.h"

namespace node {
namespace socketsecurity {
namespace temporal {

// Returns the system's current epoch nanoseconds via V8's clock (no
// syscall plumbing in this layer). Mirrors upstream's
// `get_system_nanoseconds`.
TemporalResult<int64_t> GetSystemEpochNanoseconds() noexcept;

// Mirrors upstream's UtcHostSystem (cfg(feature = "sys")):
// system clock + UTC fallback time zone.
class UtcHostSystem final : public HostHooks {
 public:
  TemporalResult<int64_t> GetHostEpochNanoseconds() override;
  TemporalResult<const TimeZone*> GetHostTimeZone() override;
};

// Mirrors upstream's LocalHostSystem (cfg(feature = "sys-local")):
// system clock + IANA-detected time zone fallback. The implementation
// punts to V8's `Intl::DefaultTimeZone()` when available.
class LocalHostSystem final : public HostHooks {
 public:
  TemporalResult<int64_t> GetHostEpochNanoseconds() override;
  TemporalResult<const TimeZone*> GetHostTimeZone() override;
};

}  // namespace temporal
}  // namespace socketsecurity
}  // namespace node

#endif  // SRC_SOCKETSECURITY_TEMPORAL_SYS_H_
