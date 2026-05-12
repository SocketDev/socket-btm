// 1:1 port of upstream `src/builtins/core/time_zone.rs` at
// temporal v0.2.3 (c003cc92325e19b26f8ee2f85e4a47d98cbcc781).
//
// Architectural deviation: upstream consults `timezone_provider`
// (a Rust crate that bundles tzdata). The C++ port delegates to V8's
// existing js-temporal-zoneinfo64.cc + the system ICU `icu::TimeZone`
// — both already linked into libnode.
//
// IANA-zone lookup is mediated by the `TimeZoneBackend` interface
// declared below. The default backend covers offset-only zones;
// embedders (V8's js-temporal layer) register an `IANATimeZoneBackend`
// at boot that delegates to `icu::TimeZone` / zoneinfo64 for IANA
// zones. This keeps temporal-infra Isolate-free while giving full
// IANA semantics at the binding boundary.

#ifndef SRC_SOCKETSECURITY_TEMPORAL_TIME_ZONE_H_
#define SRC_SOCKETSECURITY_TEMPORAL_TIME_ZONE_H_

#include <cstddef>
#include <cstdint>
#include <string>
#include <string_view>

#include "socketsecurity/temporal/error.h"
#include "socketsecurity/temporal/options.h"
#include "socketsecurity/temporal/temporal.h"

namespace node {
namespace socketsecurity {
namespace temporal {

// Mirror of upstream's `UtcOffset(i64)` newtype — offset stored in
// nanoseconds.
class UtcOffset {
 public:
  constexpr UtcOffset() noexcept : nanoseconds_(0) {}
  explicit constexpr UtcOffset(int64_t nanoseconds) noexcept
      : nanoseconds_(nanoseconds) {}

  static constexpr UtcOffset FromSeconds(int64_t seconds) noexcept {
    return UtcOffset(seconds * 1'000'000'000LL);
  }
  static constexpr UtcOffset FromMinutes(int64_t minutes) noexcept {
    return UtcOffset(minutes * 60LL * 1'000'000'000LL);
  }

  // Mirror of upstream's `from_utf8`. Parses ±HH, ±HHMM, ±HH:MM,
  // ±HH:MM:SS, and ±HH:MM:SS.fff offsets.
  static TemporalResult<UtcOffset> FromUtf8(const uint8_t* data,
                                              size_t length) noexcept;

  constexpr int64_t Nanoseconds() const noexcept { return nanoseconds_; }
  constexpr int64_t Seconds() const noexcept {
    return nanoseconds_ / 1'000'000'000LL;
  }

  // Mirror of upstream's `to_string`. Returns "Z" for zero offset
  // (when explicit_z is true), otherwise "+HH:MM" / "-HH:MM:SS.fff".
  std::string ToString() const;

  bool operator==(const UtcOffset& other) const noexcept {
    return nanoseconds_ == other.nanoseconds_;
  }
  bool operator!=(const UtcOffset& other) const noexcept {
    return nanoseconds_ != other.nanoseconds_;
  }

 private:
  int64_t nanoseconds_;
};

// Mirror of upstream's `TimeZone`. Either a UTC offset (no IANA name)
// or an IANA name (e.g. "America/New_York"). Upstream uses an enum;
// here we use a tagged-union-style class.
class TimeZone {
 public:
  enum class Kind : uint8_t {
    kOffsetOnly,
    kIanaIdentifier,
  };

  // Default-constructed TimeZone is a UTC offset-only zone with offset 0
  // — same as Utc(). Public so ZonedDateTime{} (which has TimeZone as an
  // aggregate member) can value-initialize. The factory methods below
  // are still the documented construction path; the default constructor
  // exists for default-init contexts only.
  TimeZone() = default;

  static TimeZone FromOffset(UtcOffset offset) noexcept {
    TimeZone tz;
    tz.kind_ = Kind::kOffsetOnly;
    tz.offset_ = offset;
    return tz;
  }

  static TimeZone Utc() noexcept {
    return FromOffset(UtcOffset(0));
  }

  // Mirror of upstream's `try_from_identifier_str`. Recognizes
  // offset-only ("+05:00") inline; IANA identifiers are handed to the
  // registered TimeZoneBackend (see below) for canonicalization and
  // validity-check.
  static TemporalResult<TimeZone> TryFromIdentifierStr(
      std::string_view identifier) noexcept;

  Kind kind() const noexcept { return kind_; }
  bool IsOffsetOnly() const noexcept { return kind_ == Kind::kOffsetOnly; }

  // For offset-only zones; UB if !IsOffsetOnly().
  UtcOffset OffsetOrNull() const noexcept { return offset_; }

  // Mirror of upstream's `identifier_with_provider`. Returns canonical
  // form (e.g. "+00:00", "America/New_York").
  std::string Identifier() const;

  // Mirror of upstream's `get_iso_datetime_for`. Converts an Instant
  // into the local IsoDateTime in this zone. For offset zones,
  // straightforward arithmetic; for IANA zones, dispatch to V8/ICU.
  TemporalResult<IsoDateTime> GetIsoDateTimeFor(
      const Instant& instant) const noexcept;

  // Mirror of upstream's `get_epoch_nanoseconds_for`. The inverse of
  // GetIsoDateTimeFor: given a wall-clock IsoDateTime in this zone,
  // return the epoch_nanoseconds of the matching Instant. For
  // offset-only zones this is straight arithmetic. For IANA zones the
  // wall clock may map to 0 (spring-forward gap), 1, or 2
  // (fall-back overlap) instants — the Disambiguation argument
  // selects which to return. Routes through TimeZoneBackend for IANA.
  TemporalResult<Int128> GetEpochNanosecondsFor(
      const IsoDateTime& datetime, Disambiguation disambiguation) const noexcept;

 private:
  friend class TimeZoneBackend;
  Kind kind_ = Kind::kOffsetOnly;
  UtcOffset offset_;
  // For IANA zones, an identifier string. Empty when offset-only.
  std::string iana_id_;
};

// ── TimeZoneBackend ───────────────────────────────────────────────────
//
// Plug-in interface for IANA time-zone resolution. The default backend
// rejects every IANA identifier (only offset-only zones work); V8's
// js-temporal layer registers a zoneinfo64-backed override at boot.

class TimeZoneBackend {
 public:
  virtual ~TimeZoneBackend() = default;

  // Canonicalize an IANA identifier (e.g. "EuROpe/DUBLIn" →
  // "Europe/Dublin"). Returns Range if the identifier doesn't name a
  // known zone. Default impl rejects every input.
  virtual TemporalResult<std::string> CanonicalizeIdentifier(
      std::string_view identifier) noexcept;

  // Compute the local IsoDateTime equivalent of the given Instant in
  // the named IANA zone. Default impl rejects every input.
  virtual TemporalResult<IsoDateTime> GetIsoDateTimeFor(
      std::string_view iana_id, const Instant& instant) noexcept;

  // Inverse of GetIsoDateTimeFor: resolve a wall-clock IsoDateTime in
  // the named IANA zone to the epoch nanoseconds of the matching
  // Instant. May error during spring-forward gaps depending on the
  // requested Disambiguation. Default impl rejects every input.
  virtual TemporalResult<Int128> GetEpochNanosecondsFor(
      std::string_view iana_id, const IsoDateTime& datetime,
      Disambiguation disambiguation) noexcept;
};

// Returns the active backend. When V8 has registered an
// IANATimeZoneBackend, that's what's returned; otherwise the default
// reject-everything backend.
TimeZoneBackend& GetTimeZoneBackend() noexcept;

// Install a backend. Caller retains ownership; pass `nullptr` to
// restore the default. Thread-safe to call once at startup.
void SetTimeZoneBackend(TimeZoneBackend* backend) noexcept;

}  // namespace temporal
}  // namespace socketsecurity
}  // namespace node

#endif  // SRC_SOCKETSECURITY_TEMPORAL_TIME_ZONE_H_
