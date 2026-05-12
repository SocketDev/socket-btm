// ICU-backed TimeZoneBackend override.
//
// Use ICU's `icu::TimeZone` (already linked into V8 when
// V8_INTL_SUPPORT is on) for IANA timezone resolution rather than
// re-implementing the zoneinfo64 binary-format parser. ICU is a
// solid, reliable C++ library that V8 and Chromium use for the same
// resolution path, so it's the right dependency to take when
// available.
//
// Registration: V8's js-temporal layer installs an instance of this
// at boot via SetTimeZoneBackend(...). When V8 is built without
// intl support the install is a no-op (ICU isn't linked); IANA
// queries fall back to the default-reject backend.
//
// The override handles three of the four virtual methods:
//   - CanonicalizeIdentifier — uses TimeZone::createTimeZone +
//     getCanonicalID to normalize aliases.
//   - GetIsoDateTimeFor — calls TimeZone::getOffset on the epoch ns
//     to recover the local wall clock.
//   - GetEpochNanosecondsFor — calls TimeZone::getOffsetFromLocal
//     with the appropriate Disambiguation flags to map a wall clock
//     to its epoch ns (handling DST gaps + overlaps).
//
// Both `getOffset` and `getOffsetFromLocal` are stable ICU API
// shipped since ICU 50; V8 has tracked recent ICU for years.

#ifndef SRC_SOCKETSECURITY_TEMPORAL_ICU_TZ_BACKEND_H_
#define SRC_SOCKETSECURITY_TEMPORAL_ICU_TZ_BACKEND_H_

#include "socketsecurity/temporal/time_zone.h"

namespace node {
namespace socketsecurity {
namespace temporal {

class IcuTimeZoneBackend : public TimeZoneBackend {
 public:
  IcuTimeZoneBackend() = default;
  ~IcuTimeZoneBackend() override = default;

  // 1:1 from upstream `TimeZone::try_from_identifier_str` (the IANA
  // branch). Uses icu::TimeZone::getCanonicalID; returns Range for
  // unrecognized identifiers (ICU's `bogus` return value).
  TemporalResult<std::string> CanonicalizeIdentifier(
      std::string_view identifier) noexcept override;

  // 1:1 from upstream `TimeZone::get_iso_datetime_for` (the IANA
  // branch). Uses icu::TimeZone::getOffset to find the wall-clock
  // offset at the given instant, then applies it to derive the
  // local IsoDateTime.
  TemporalResult<IsoDateTime> GetIsoDateTimeFor(
      std::string_view iana_id, const Instant& instant) noexcept override;

  // 1:1 from upstream `TimeZone::get_epoch_nanoseconds_for`. Uses
  // icu::TimeZone::getOffsetFromLocal with the
  // kFormer/kLatter/kStandard/kDaylight selectors translated from
  // the spec's Disambiguation enum.
  TemporalResult<Int128> GetEpochNanosecondsFor(
      std::string_view iana_id, const IsoDateTime& datetime,
      Disambiguation disambiguation) noexcept override;
};

// Install the ICU-backed backend as the active TimeZoneBackend.
// Idempotent — calling twice replaces the previous singleton.
// No-op when V8 is built without V8_INTL_SUPPORT (ICU not linked).
void InstallIcuTimeZoneBackend() noexcept;

}  // namespace temporal
}  // namespace socketsecurity
}  // namespace node

#endif  // SRC_SOCKETSECURITY_TEMPORAL_ICU_TZ_BACKEND_H_
