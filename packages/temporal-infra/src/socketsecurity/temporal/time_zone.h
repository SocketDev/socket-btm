// 1:1 port of upstream `src/builtins/core/time_zone.rs` at
// temporal v0.2.3 (c003cc92325e19b26f8ee2f85e4a47d98cbcc781).
//
// Architectural deviation: upstream consults `timezone_provider`
// (a Rust crate that bundles tzdata). The C++ port delegates to V8's
// existing js-temporal-zoneinfo64.cc + the system ICU `icu::TimeZone`
// — both already linked into libnode.
//
// SCAFFOLD: this header defines the public surface (UtcOffset,
// TimeZone wrapper). The implementations below cover offset-only
// time zones (which don't need tzdata); IANA-named zones stub to
// TemporalError until the V8/ICU dispatch lands.

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

  static TimeZone FromOffset(UtcOffset offset) noexcept {
    TimeZone tz;
    tz.kind_ = Kind::kOffsetOnly;
    tz.offset_ = offset;
    return tz;
  }

  static TimeZone Utc() noexcept {
    return FromOffset(UtcOffset(0));
  }

  // Mirror of upstream's `try_from_identifier_str`. IANA path stubs to
  // TemporalError until V8 zoneinfo64 dispatch lands. Offset-only path
  // ("+05:00") works today.
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

 private:
  TimeZone() = default;
  Kind kind_ = Kind::kOffsetOnly;
  UtcOffset offset_;
  // For IANA zones, an identifier string. Empty when offset-only.
  std::string iana_id_;
};

}  // namespace temporal
}  // namespace socketsecurity
}  // namespace node

#endif  // SRC_SOCKETSECURITY_TEMPORAL_TIME_ZONE_H_
