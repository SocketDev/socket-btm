// 1:1 port of upstream `src/host.rs` at temporal v0.2.3
// (c003cc92325e19b26f8ee2f85e4a47d98cbcc781).
//
// Lock-step from Rust: host.rs
//
// Rust uses three trait shapes (HostClock, HostTimeZone, HostHooks) to let
// callers swap out the system clock and time zone for testing. C++ has no
// trait inheritance — we model it with a single `HostHooks` abstract base
// class whose two virtuals correspond to upstream's clock + time-zone
// methods. Default implementations delegate the same way Rust does.
//
// EmptyHostSystem (Rust) → DefaultEmptyHostSystem (C++): always returns
// epoch 0 + UTC, useful for fixtures and the smoke-test harness.

#ifndef SRC_SOCKETSECURITY_TEMPORAL_HOST_H_
#define SRC_SOCKETSECURITY_TEMPORAL_HOST_H_

#include <cstdint>

#include "socketsecurity/temporal/error.h"

namespace node {
namespace socketsecurity {
namespace temporal {

// Forward decl — TimeZone lands in a later port phase.
class TimeZone;

// Mirrors upstream's `HostHooks` (which extends `HostClock + HostTimeZone`).
// A subclass overrides Clock/TimeZone to inject test or production sources.
//
// V8 callers hook this via the higher-level wrapper
// `js-temporal-objects.cc`; the default flow uses
// `std::chrono::system_clock::now()` (see DefaultEmptyHostSystem below).
class HostHooks {
 public:
  virtual ~HostHooks() = default;

  // Returns the host's current epoch nanoseconds. Implementations may
  // surface a TemporalError (e.g. clock failure on systems without a
  // monotonic clock). Default GetSystem* methods just delegate.
  virtual TemporalResult<int64_t> GetHostEpochNanoseconds() = 0;
  // Returns the host's preferred time zone. Subclasses may return a UTC
  // fallback or a system-detected IANA zone. Pointer ownership stays
  // with the implementation.
  virtual TemporalResult<const TimeZone*> GetHostTimeZone() = 0;

  // Defaults — Rust gives these as default trait impls on `HostHooks`.
  virtual TemporalResult<int64_t> GetSystemEpochNanoseconds() {
    return GetHostEpochNanoseconds();
  }
  virtual TemporalResult<const TimeZone*> GetSystemTimeZone() {
    return GetHostTimeZone();
  }
};

// Mirrors upstream's EmptyHostSystem: returns epoch 0 and UTC. Useful as
// a default fallback (e.g. for tests) when the embedder doesn't supply a
// host. Implementation lives in host.cc.
class DefaultEmptyHostSystem final : public HostHooks {
 public:
  TemporalResult<int64_t> GetHostEpochNanoseconds() override;
  TemporalResult<const TimeZone*> GetHostTimeZone() override;
};

}  // namespace temporal
}  // namespace socketsecurity
}  // namespace node

#endif  // SRC_SOCKETSECURITY_TEMPORAL_HOST_H_
