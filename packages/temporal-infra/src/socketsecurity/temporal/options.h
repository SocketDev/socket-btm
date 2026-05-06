// 1:1 port of upstream `src/options.rs` (+ `src/options/increment.rs`)
// at temporal v0.2.3 (c003cc92325e19b26f8ee2f85e4a47d98cbcc781).
//
// Maps every options enum (Unit, UnitGroup, Overflow, Disambiguation,
// OffsetDisambiguation, RoundingMode, UnsignedRoundingMode,
// DisplayCalendar, DisplayOffset, DisplayTimeZone) and their FromStr /
// Display impls. Plus RoundingIncrement (from src/options/increment.rs)
// and RoundingOptions / DifferenceSettings / ResolvedRoundingOptions /
// ToStringRoundingOptions / ResolvedToStringRoundingOptions.
//
// `RelativeTo` (from src/options/relative_to.rs) lands with
// zoned_date_time.cc since it depends on the full TimeZone class.

#ifndef SRC_SOCKETSECURITY_TEMPORAL_OPTIONS_H_
#define SRC_SOCKETSECURITY_TEMPORAL_OPTIONS_H_

#include <cstdint>
#include <optional>
#include <string_view>

#include "socketsecurity/temporal/error.h"

namespace node {
namespace socketsecurity {
namespace temporal {

// ── Unit + UnitGroup ──────────────────────────────────────────────────
//
// Mirror of upstream's `Unit` enum. Numeric values match upstream
// (Auto = 0, Nanosecond = 1, …, Year = 10) so that `larger()` /
// `table_index()` can use direct comparison.
enum class Unit : uint8_t {
  kAuto = 0,
  kNanosecond = 1,
  kMicrosecond = 2,
  kMillisecond = 3,
  kSecond = 4,
  kMinute = 5,
  kHour = 6,
  kDay = 7,
  kWeek = 8,
  kMonth = 9,
  kYear = 10,
};

// `Table 21: Temporal units by descending magnitude`. Iteration order
// matches upstream's `UNIT_VALUE_TABLE`.
inline constexpr Unit kUnitValueTable[10] = {
    Unit::kYear,        Unit::kMonth,       Unit::kWeek,        Unit::kDay,
    Unit::kHour,        Unit::kMinute,      Unit::kSecond,      Unit::kMillisecond,
    Unit::kMicrosecond, Unit::kNanosecond,
};

// Mirror of upstream's `Unit::is_calendar_unit` / `is_date_unit` /
// `is_time_unit`.
constexpr bool UnitIsCalendarUnit(Unit u) noexcept {
  return u == Unit::kYear || u == Unit::kMonth || u == Unit::kWeek;
}
constexpr bool UnitIsDateUnit(Unit u) noexcept {
  return u == Unit::kDay || UnitIsCalendarUnit(u);
}
constexpr bool UnitIsTimeUnit(Unit u) noexcept {
  return u == Unit::kHour || u == Unit::kMinute || u == Unit::kSecond ||
         u == Unit::kMillisecond || u == Unit::kMicrosecond ||
         u == Unit::kNanosecond;
}

// Mirror of upstream's `Unit::to_maximum_rounding_increment`.
// Returns std::nullopt for year/month/week/day (no maximum) and for
// Auto (caller error — assert in debug, return nullopt in release).
std::optional<uint32_t> UnitMaximumRoundingIncrement(Unit u) noexcept;

// Mirror of upstream's `Unit::as_nanoseconds`. Returns std::nullopt for
// year/month/week (calendar units; not nanosecond-multiples) and for
// Auto. Otherwise the exact ns count for one Unit.
std::optional<uint64_t> UnitAsNanoseconds(Unit u) noexcept;

// Mirror of upstream's `Unit::larger(u1, u2)`. Returns the
// larger-magnitude unit. Errors if either is Auto.
TemporalResult<Unit> UnitLarger(Unit u1, Unit u2) noexcept;

// Mirror of upstream's `Unit::FromStr` / `Display`. Accepts
// singular + plural ("year" or "years"), case-sensitive.
TemporalResult<Unit> UnitFromString(std::string_view s) noexcept;
std::string_view UnitToString(Unit u) noexcept;

// Mirror of upstream's `UnitGroup`.
enum class UnitGroup : uint8_t {
  kDate,
  kTime,
  kDateTime,
};

// Mirror of upstream's `UnitGroup::validate_unit`.
TemporalResult<void> UnitGroupValidateUnit(
    UnitGroup group, std::optional<Unit> unit,
    std::optional<Unit> extra_unit) noexcept;

// Mirror of upstream's `UnitGroup::validate_required_unit`.
TemporalResult<Unit> UnitGroupValidateRequiredUnit(
    UnitGroup group, std::optional<Unit> unit,
    std::optional<Unit> extra_unit) noexcept;

// ── Overflow ──────────────────────────────────────────────────────────
//
// Mirror of upstream's `Overflow` enum. NOTE: plain_time.h shipped an
// earlier version under the same name `Overflow`. We're consolidating
// here; plain_time.h includes options.h and the duplicated definition
// is removed in this commit.
enum class Overflow : uint8_t {
  kConstrain = 0,  // default
  kReject = 1,
};

TemporalResult<Overflow> OverflowFromString(std::string_view s) noexcept;
std::string_view OverflowToString(Overflow o) noexcept;

// ── Disambiguation ────────────────────────────────────────────────────
enum class Disambiguation : uint8_t {
  kCompatible = 0,  // default
  kEarlier = 1,
  kLater = 2,
  kReject = 3,
};

TemporalResult<Disambiguation> DisambiguationFromString(
    std::string_view s) noexcept;
std::string_view DisambiguationToString(Disambiguation d) noexcept;

// ── OffsetDisambiguation ──────────────────────────────────────────────
enum class OffsetDisambiguation : uint8_t {
  kUse,
  kPrefer,
  kIgnore,
  kReject,
};

TemporalResult<OffsetDisambiguation> OffsetDisambiguationFromString(
    std::string_view s) noexcept;
std::string_view OffsetDisambiguationToString(OffsetDisambiguation d) noexcept;

// ── RoundingMode ──────────────────────────────────────────────────────
enum class RoundingMode : uint8_t {
  kCeil,
  kFloor,
  kExpand,
  kTrunc,
  kHalfCeil,
  kHalfFloor,
  kHalfExpand,  // default
  kHalfTrunc,
  kHalfEven,
};

// Mirror of upstream's `UnsignedRoundingMode`.
enum class UnsignedRoundingMode : uint8_t {
  kInfinity,
  kZero,
  kHalfInfinity,
  kHalfZero,
  kHalfEven,
};

// Mirror of upstream's `RoundingMode::negate`.
constexpr RoundingMode RoundingModeNegate(RoundingMode m) noexcept {
  switch (m) {
    case RoundingMode::kCeil:
      return RoundingMode::kFloor;
    case RoundingMode::kFloor:
      return RoundingMode::kCeil;
    case RoundingMode::kHalfCeil:
      return RoundingMode::kHalfFloor;
    case RoundingMode::kHalfFloor:
      return RoundingMode::kHalfCeil;
    case RoundingMode::kTrunc:
    case RoundingMode::kExpand:
    case RoundingMode::kHalfTrunc:
    case RoundingMode::kHalfExpand:
    case RoundingMode::kHalfEven:
      return m;
  }
  return m;
}

// Mirror of upstream's `RoundingMode::get_unsigned_round_mode`.
UnsignedRoundingMode RoundingModeGetUnsigned(RoundingMode m,
                                              bool is_positive) noexcept;

// Mirror of upstream's `UnsignedRoundingMode::apply`.
// `dividend / divisor` represents the value `x`; `r1`/`r2` are the
// candidate integer-rounded results. Caller passes the appropriate
// dividend/divisor pair.
int64_t UnsignedRoundingModeApply(UnsignedRoundingMode m, uint64_t dividend,
                                    uint64_t divisor, int64_t r1,
                                    int64_t r2) noexcept;

TemporalResult<RoundingMode> RoundingModeFromString(
    std::string_view s) noexcept;
std::string_view RoundingModeToString(RoundingMode m) noexcept;

// ── RoundingIncrement ─────────────────────────────────────────────────
//
// Mirror of upstream's `RoundingIncrement(NonZeroU32)` newtype with the
// invariant `1..=10^9`.
class RoundingIncrement {
 public:
  // Default = 1.
  constexpr RoundingIncrement() noexcept : value_(1) {}

  static constexpr RoundingIncrement One() noexcept {
    return RoundingIncrement(1);
  }

  // Mirrors upstream's `try_new(u32)`.
  static TemporalResult<RoundingIncrement> TryNew(uint32_t increment) noexcept;
  // Mirrors upstream's `TryFrom<f64>`.
  static TemporalResult<RoundingIncrement> TryFromF64(double value) noexcept;

  // Mirrors upstream's `get()`.
  constexpr uint32_t Get() const noexcept { return value_; }

  // Mirrors upstream's `validate(dividend, inclusive)`.
  TemporalResult<void> Validate(uint64_t dividend,
                                  bool inclusive) const noexcept;

  bool operator==(const RoundingIncrement& other) const noexcept {
    return value_ == other.value_;
  }

 private:
  explicit constexpr RoundingIncrement(uint32_t v) noexcept : value_(v) {}
  uint32_t value_;
};

// ── DifferenceOperation ───────────────────────────────────────────────
enum class DifferenceOperation : uint8_t {
  kUntil,
  kSince,
};

// ── DifferenceSettings / RoundingOptions ──────────────────────────────
struct DifferenceSettings {
  std::optional<Unit> largest_unit;
  std::optional<Unit> smallest_unit;
  std::optional<RoundingMode> rounding_mode;
  std::optional<RoundingIncrement> increment;
};

struct RoundingOptions {
  std::optional<Unit> largest_unit;  // Default: Unit::kAuto
  std::optional<Unit> smallest_unit;
  std::optional<RoundingMode> rounding_mode;
  std::optional<RoundingIncrement> increment;
};

// Mirror of upstream's `Precision`. `Auto` means auto-precision (drop
// trailing zeros); `Minute` means truncate at minute; `Digit(n)` means
// exactly n fractional digits (0..9).
struct Precision {
  enum class Kind : uint8_t { kAuto, kMinute, kDigit };
  Kind kind = Kind::kAuto;
  uint8_t digits = 0;  // valid only when kind == kDigit
};

// Mirror of upstream's `ToStringRoundingOptions`.
struct ToStringRoundingOptions {
  Precision precision;
  std::optional<Unit> smallest_unit;
  std::optional<RoundingMode> rounding_mode;
};

// Mirror of upstream's `ResolvedToStringRoundingOptions`.
struct ResolvedToStringRoundingOptions {
  Precision precision;
  Unit smallest_unit;
  RoundingMode rounding_mode;
  RoundingIncrement increment;
};

// Mirror of upstream's `ToStringRoundingOptions::resolve`.
TemporalResult<ResolvedToStringRoundingOptions> ToStringRoundingOptionsResolve(
    const ToStringRoundingOptions& options) noexcept;

// Mirror of upstream's `ResolvedRoundingOptions`.
struct ResolvedRoundingOptions {
  Unit largest_unit;
  Unit smallest_unit;
  RoundingIncrement increment;
  RoundingMode rounding_mode;

  // Mirror of upstream's `ResolvedRoundingOptions::is_noop`.
  bool IsNoop() const noexcept {
    return smallest_unit == Unit::kNanosecond &&
           increment == RoundingIncrement::One();
  }
};

// Mirror of upstream's `ResolvedRoundingOptions::from_diff_settings`.
TemporalResult<ResolvedRoundingOptions> ResolvedRoundingOptionsFromDiffSettings(
    const DifferenceSettings& options, DifferenceOperation operation,
    UnitGroup unit_group, Unit fallback_largest,
    Unit fallback_smallest) noexcept;

// Mirror of upstream's `from_datetime_options` / `from_time_options` /
// `from_instant_options` / `from_to_string_options`.
TemporalResult<ResolvedRoundingOptions> ResolvedRoundingOptionsFromDateTime(
    const RoundingOptions& options) noexcept;
TemporalResult<ResolvedRoundingOptions> ResolvedRoundingOptionsFromTime(
    const RoundingOptions& options) noexcept;
TemporalResult<ResolvedRoundingOptions> ResolvedRoundingOptionsFromInstant(
    const RoundingOptions& options) noexcept;
ResolvedRoundingOptions ResolvedRoundingOptionsFromToString(
    const ResolvedToStringRoundingOptions& options) noexcept;

// ── Display* enums ────────────────────────────────────────────────────
enum class DisplayCalendar : uint8_t {
  kAuto = 0,  // default
  kAlways = 1,
  kNever = 2,
  kCritical = 3,
};

enum class DisplayOffset : uint8_t {
  kAuto = 0,  // default
  kNever = 1,
};

enum class DisplayTimeZone : uint8_t {
  kAuto = 0,  // default
  kNever = 1,
  kCritical = 2,
};

TemporalResult<DisplayCalendar> DisplayCalendarFromString(
    std::string_view s) noexcept;
std::string_view DisplayCalendarToString(DisplayCalendar d) noexcept;

TemporalResult<DisplayOffset> DisplayOffsetFromString(
    std::string_view s) noexcept;
std::string_view DisplayOffsetToString(DisplayOffset d) noexcept;

TemporalResult<DisplayTimeZone> DisplayTimeZoneFromString(
    std::string_view s) noexcept;
std::string_view DisplayTimeZoneToString(DisplayTimeZone d) noexcept;

}  // namespace temporal
}  // namespace socketsecurity
}  // namespace node

#endif  // SRC_SOCKETSECURITY_TEMPORAL_OPTIONS_H_
