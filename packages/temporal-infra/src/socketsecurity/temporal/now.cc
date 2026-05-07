// 1:1 port of upstream `src/builtins/core/now.rs`.

#include "socketsecurity/temporal/now.h"

#include "socketsecurity/temporal/calendar.h"
#include "socketsecurity/temporal/temporal.h"
#include "socketsecurity/temporal/time_zone.h"
#include "socketsecurity/temporal/zoned_date_time.h"

namespace node {
namespace socketsecurity {
namespace temporal {

namespace {

// Helper: build an Instant from an i64 nanosecond reading. Mirrors
// upstream's `Instant::from(EpochNanoseconds)`.
Instant InstantFromI64Ns(int64_t ns) noexcept {
  Instant out{};
  out.epoch_nanoseconds = Int128(ns);
  return out;
}

}  // namespace

TemporalResult<Instant> Now::InstantNow() {
  // Upstream: `Ok(Instant::from(self.host_hooks.get_system_epoch_nanoseconds()?))`
  auto ns = hooks_->GetSystemEpochNanoseconds();
  if (!ns.ok()) {
    return ns.error();
  }
  Instant inst = InstantFromI64Ns(ns.value());
  if (!inst.IsValid()) {
    return TemporalError::Range("System time is outside the valid Instant range");
  }
  return inst;
}

TemporalResult<TimeZone> Now::TimeZoneWithProvider() {
  // Upstream: `self.host_hooks.get_system_time_zone(provider)`.
  auto tz_ptr = hooks_->GetSystemTimeZone();
  if (!tz_ptr.ok()) {
    return tz_ptr.error();
  }
  // Hooks own the TimeZone; we copy it out by value (Rust's `TimeZone`
  // is Clone, our C++ TimeZone is copyable too).
  return *tz_ptr.value();
}

namespace {

// Helper: resolve a TimeZone argument — use the caller-provided zone
// when set; otherwise consult the host hooks. Mirrors upstream's
// `time_zone.unwrap_or(self.host_hooks.get_system_time_zone(provider)?)`.
TemporalResult<TimeZone> ResolveTimeZone(HostHooks& hooks,
                                          const TimeZone* tz_or_null) noexcept {
  if (tz_or_null != nullptr) {
    return *tz_or_null;
  }
  auto host_tz = hooks.GetSystemTimeZone();
  if (!host_tz.ok()) {
    return host_tz.error();
  }
  return *host_tz.value();
}

}  // namespace

TemporalResult<ZonedDateTime> Now::ZonedDateTimeIsoWithProvider(
    const TimeZone* tz_or_null) {
  auto inst = InstantNow();
  if (!inst.ok()) {
    return inst.error();
  }
  auto tz = ResolveTimeZone(*hooks_, tz_or_null);
  if (!tz.ok()) {
    return tz.error();
  }
  return ZonedDateTimeTryNew(inst.value(), tz.value(), Calendar::Iso());
}

TemporalResult<PlainDateTime> Now::PlainDateTimeIsoWithProvider(
    const TimeZone* tz_or_null) {
  auto inst = InstantNow();
  if (!inst.ok()) {
    return inst.error();
  }
  auto tz = ResolveTimeZone(*hooks_, tz_or_null);
  if (!tz.ok()) {
    return tz.error();
  }
  auto idt = tz.value().GetIsoDateTimeFor(inst.value());
  if (!idt.ok()) {
    return idt.error();
  }
  PlainDateTime out{};
  out.iso = idt.value();
  return out;
}

TemporalResult<PlainDate> Now::PlainDateIsoWithProvider(
    const TimeZone* tz_or_null) {
  auto pdt = PlainDateTimeIsoWithProvider(tz_or_null);
  if (!pdt.ok()) {
    return pdt.error();
  }
  PlainDate out{};
  out.iso = pdt.value().iso.date;
  return out;
}

TemporalResult<PlainTime> Now::PlainTimeIsoWithProvider(
    const TimeZone* tz_or_null) {
  auto pdt = PlainDateTimeIsoWithProvider(tz_or_null);
  if (!pdt.ok()) {
    return pdt.error();
  }
  PlainTime out{};
  out.iso = pdt.value().iso.time;
  return out;
}

}  // namespace temporal
}  // namespace socketsecurity
}  // namespace node
