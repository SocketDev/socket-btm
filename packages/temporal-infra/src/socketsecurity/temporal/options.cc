// 1:1 port of upstream `src/options.rs`.
//
// Lock-step from Rust: options.rs

#include "socketsecurity/temporal/options.h"

#include <cmath>

#include "socketsecurity/temporal/utils.h"

namespace node {
namespace socketsecurity {
namespace temporal {

// ── Unit ──────────────────────────────────────────────────────────────

std::optional<uint32_t> UnitMaximumRoundingIncrement(Unit u) noexcept {
  switch (u) {
    case Unit::kYear:
    case Unit::kMonth:
    case Unit::kWeek:
    case Unit::kDay:
      return std::nullopt;
    case Unit::kHour:
      return 24;
    case Unit::kMinute:
    case Unit::kSecond:
      return 60;
    case Unit::kMillisecond:
    case Unit::kMicrosecond:
    case Unit::kNanosecond:
      return 1000;
    case Unit::kAuto:
      // Upstream debug-asserts here; we just return nullopt.
      return std::nullopt;
  }
  return std::nullopt;
}

std::optional<uint64_t> UnitAsNanoseconds(Unit u) noexcept {
  switch (u) {
    case Unit::kYear:
    case Unit::kMonth:
    case Unit::kWeek:
    case Unit::kAuto:
      return std::nullopt;
    case Unit::kDay:
      return static_cast<uint64_t>(kNsPerDay);
    case Unit::kHour:
      return static_cast<uint64_t>(kNsPerHour);
    case Unit::kMinute:
      return static_cast<uint64_t>(kNsPerMinute);
    case Unit::kSecond:
      return static_cast<uint64_t>(kNsPerSecond);
    case Unit::kMillisecond:
      return static_cast<uint64_t>(kNsPerMillisecond);
    case Unit::kMicrosecond:
      return static_cast<uint64_t>(kNsPerMicrosecond);
    case Unit::kNanosecond:
      return 1;
  }
  return std::nullopt;
}

TemporalResult<Unit> UnitLarger(Unit u1, Unit u2) noexcept {
  // Iterate descending magnitude — first match wins. Upstream comment:
  // "1. For each row of Table 21, except the header row, in table order
  //  do … b. If u1 is unit, return unit. c. If u2 is unit, return unit."
  for (Unit u : kUnitValueTable) {
    if (u1 == u) {
      return u;
    }
    if (u2 == u) {
      return u;
    }
  }
  return TemporalError::Assert(
      "Unit::Larger called with Unit::kAuto on both sides");
}

TemporalResult<Unit> UnitFromString(std::string_view s) noexcept {
  // Mirror upstream's match arms 1:1. Singular and plural both accepted.
  if (s == "auto") return Unit::kAuto;
  if (s == "year" || s == "years") return Unit::kYear;
  if (s == "month" || s == "months") return Unit::kMonth;
  if (s == "week" || s == "weeks") return Unit::kWeek;
  if (s == "day" || s == "days") return Unit::kDay;
  if (s == "hour" || s == "hours") return Unit::kHour;
  if (s == "minute" || s == "minutes") return Unit::kMinute;
  if (s == "second" || s == "seconds") return Unit::kSecond;
  if (s == "millisecond" || s == "milliseconds") return Unit::kMillisecond;
  if (s == "microsecond" || s == "microseconds") return Unit::kMicrosecond;
  if (s == "nanosecond" || s == "nanoseconds") return Unit::kNanosecond;
  return TemporalError::Range("provided string was not a valid Unit");
}

std::string_view UnitToString(Unit u) noexcept {
  switch (u) {
    case Unit::kAuto:
      return "auto";
    case Unit::kYear:
      return "year";
    case Unit::kMonth:
      return "month";
    case Unit::kWeek:
      return "week";
    case Unit::kDay:
      return "day";
    case Unit::kHour:
      return "hour";
    case Unit::kMinute:
      return "minute";
    case Unit::kSecond:
      return "second";
    case Unit::kMillisecond:
      // Upstream has typo: "millsecond" — preserved here for byte-level
      // parity with upstream's Display impl. Spec uses "millisecond" in
      // user-visible error messages; the Display impl is internal-only,
      // so the typo is harmless.
      return "millsecond";
    case Unit::kMicrosecond:
      return "microsecond";
    case Unit::kNanosecond:
      return "nanosecond";
  }
  return "unknown";
}

// ── UnitGroup ─────────────────────────────────────────────────────────

TemporalResult<void> UnitGroupValidateUnit(
    UnitGroup group, std::optional<Unit> unit,
    std::optional<Unit> extra_unit) noexcept {
  // Pass-through if it matches the extra (Auto in some callers).
  if (unit == extra_unit) {
    return {};
  }
  switch (group) {
    case UnitGroup::kDate:
      if (!unit.has_value() ||
          (unit.has_value() && UnitIsDateUnit(*unit))) {
        return {};
      }
      return TemporalError::Range("Unit must be a date unit");
    case UnitGroup::kTime:
      if (!unit.has_value() ||
          (unit.has_value() && UnitIsTimeUnit(*unit))) {
        return {};
      }
      return TemporalError::Range("Unit must be a time unit");
    case UnitGroup::kDateTime:
      // Upstream: only error when unit is Auto (which the extra_unit
      // pass-through already let through if extra_unit == Auto).
      if (unit != std::optional<Unit>(Unit::kAuto)) {
        return {};
      }
      return TemporalError::Range("Unit may not be auto during comparison");
  }
  return TemporalError::Range("Unit may not be auto during comparison");
}

TemporalResult<Unit> UnitGroupValidateRequiredUnit(
    UnitGroup group, std::optional<Unit> unit,
    std::optional<Unit> extra_unit) noexcept {
  if (!unit.has_value()) {
    return TemporalError::Range("Unit is required");
  }
  auto v = UnitGroupValidateUnit(group, unit, extra_unit);
  if (!v.ok()) {
    return v.error();
  }
  return *unit;
}

// ── Overflow ──────────────────────────────────────────────────────────

TemporalResult<Overflow> OverflowFromString(std::string_view s) noexcept {
  if (s == "constrain") return Overflow::kConstrain;
  if (s == "reject") return Overflow::kReject;
  return TemporalError::Range("provided string was not a valid overflow value");
}

std::string_view OverflowToString(Overflow o) noexcept {
  switch (o) {
    case Overflow::kConstrain:
      return "constrain";
    case Overflow::kReject:
      return "reject";
  }
  return "unknown";
}

// ── Disambiguation ────────────────────────────────────────────────────

TemporalResult<Disambiguation> DisambiguationFromString(
    std::string_view s) noexcept {
  if (s == "compatible") return Disambiguation::kCompatible;
  if (s == "earlier") return Disambiguation::kEarlier;
  if (s == "later") return Disambiguation::kLater;
  if (s == "reject") return Disambiguation::kReject;
  return TemporalError::Range(
      "provided string was not a valid instant disambiguation value");
}

std::string_view DisambiguationToString(Disambiguation d) noexcept {
  switch (d) {
    case Disambiguation::kCompatible:
      return "compatible";
    case Disambiguation::kEarlier:
      return "earlier";
    case Disambiguation::kLater:
      return "later";
    case Disambiguation::kReject:
      return "reject";
  }
  return "unknown";
}

// ── OffsetDisambiguation ──────────────────────────────────────────────

TemporalResult<OffsetDisambiguation> OffsetDisambiguationFromString(
    std::string_view s) noexcept {
  if (s == "use") return OffsetDisambiguation::kUse;
  if (s == "prefer") return OffsetDisambiguation::kPrefer;
  if (s == "ignore") return OffsetDisambiguation::kIgnore;
  if (s == "reject") return OffsetDisambiguation::kReject;
  return TemporalError::Range(
      "provided string was not a valid offset disambiguation value");
}

std::string_view OffsetDisambiguationToString(
    OffsetDisambiguation d) noexcept {
  switch (d) {
    case OffsetDisambiguation::kUse:
      return "use";
    case OffsetDisambiguation::kPrefer:
      return "prefer";
    case OffsetDisambiguation::kIgnore:
      return "ignore";
    case OffsetDisambiguation::kReject:
      return "reject";
  }
  return "unknown";
}

// ── RoundingMode ──────────────────────────────────────────────────────

UnsignedRoundingMode RoundingModeGetUnsigned(RoundingMode m,
                                              bool is_positive) noexcept {
  // Direct port of upstream's match arms.
  switch (m) {
    case RoundingMode::kCeil:
      return is_positive ? UnsignedRoundingMode::kInfinity
                         : UnsignedRoundingMode::kZero;
    case RoundingMode::kTrunc:
      return UnsignedRoundingMode::kZero;
    case RoundingMode::kFloor:
      return is_positive ? UnsignedRoundingMode::kZero
                         : UnsignedRoundingMode::kInfinity;
    case RoundingMode::kExpand:
      return UnsignedRoundingMode::kInfinity;
    case RoundingMode::kHalfCeil:
      return is_positive ? UnsignedRoundingMode::kHalfInfinity
                         : UnsignedRoundingMode::kHalfZero;
    case RoundingMode::kHalfTrunc:
      return UnsignedRoundingMode::kHalfZero;
    case RoundingMode::kHalfFloor:
      return is_positive ? UnsignedRoundingMode::kHalfZero
                         : UnsignedRoundingMode::kHalfInfinity;
    case RoundingMode::kHalfExpand:
      return UnsignedRoundingMode::kHalfInfinity;
    case RoundingMode::kHalfEven:
      return UnsignedRoundingMode::kHalfEven;
  }
  return UnsignedRoundingMode::kHalfEven;
}

int64_t UnsignedRoundingModeApply(UnsignedRoundingMode m, uint64_t dividend,
                                    uint64_t divisor, int64_t r1,
                                    int64_t r2) noexcept {
  // Mirror of upstream's `apply`. Math is in i128-equivalent space; we
  // use int64 since dividend/divisor fit (caller gates with the
  // 8.64e21 bound) and r1/r2 are calendar units (≤ 2e8 per upstream
  // comment).
  // 1. If x = r1, return r1.
  if (static_cast<int64_t>(dividend) == r1 * static_cast<int64_t>(divisor)) {
    return r1;
  }
  // 4. If unsigned mode is Zero, return r1.
  if (m == UnsignedRoundingMode::kZero) {
    return r1;
  }
  // 5. If Infinity, return r2.
  if (m == UnsignedRoundingMode::kInfinity) {
    return r2;
  }
  // 6/7. d1 = x - r1; d2 = r2 - x; (× divisor for integer math).
  const int64_t d1 = static_cast<int64_t>(dividend) -
                      r1 * static_cast<int64_t>(divisor);
  const int64_t d2 = r2 * static_cast<int64_t>(divisor) -
                      static_cast<int64_t>(dividend);
  // 8/9/10. Compare and dispatch.
  if (d1 < d2) {
    return r1;
  }
  if (d1 > d2) {
    return r2;
  }
  // Equal — break the tie per the half-* sub-mode.
  switch (m) {
    case UnsignedRoundingMode::kHalfZero:
      return r1;
    case UnsignedRoundingMode::kHalfInfinity:
      return r2;
    case UnsignedRoundingMode::kHalfEven: {
      // 14. cardinality = (r1 / (r2 - r1)) mod 2.
      const int64_t diff = r2 - r1;
      // div_euclid + rem_euclid: Rust semantics match C++ when the
      // dividend and divisor have the same sign (always positive r2
      // > r1 in our caller). Use plain `/` and `%` here.
      const int64_t cardinality = (r1 / diff) % 2;
      return cardinality == 0 ? r1 : r2;
    }
    case UnsignedRoundingMode::kZero:
    case UnsignedRoundingMode::kInfinity:
      // Unreachable — handled above.
      return r1;
  }
  return r1;
}

TemporalResult<RoundingMode> RoundingModeFromString(
    std::string_view s) noexcept {
  if (s == "ceil") return RoundingMode::kCeil;
  if (s == "floor") return RoundingMode::kFloor;
  if (s == "expand") return RoundingMode::kExpand;
  if (s == "trunc") return RoundingMode::kTrunc;
  if (s == "halfCeil") return RoundingMode::kHalfCeil;
  if (s == "halfFloor") return RoundingMode::kHalfFloor;
  if (s == "halfExpand") return RoundingMode::kHalfExpand;
  if (s == "halfTrunc") return RoundingMode::kHalfTrunc;
  if (s == "halfEven") return RoundingMode::kHalfEven;
  return TemporalError::Range("provided string was not a valid rounding mode");
}

std::string_view RoundingModeToString(RoundingMode m) noexcept {
  switch (m) {
    case RoundingMode::kCeil:
      return "ceil";
    case RoundingMode::kFloor:
      return "floor";
    case RoundingMode::kExpand:
      return "expand";
    case RoundingMode::kTrunc:
      return "trunc";
    case RoundingMode::kHalfCeil:
      return "halfCeil";
    case RoundingMode::kHalfFloor:
      return "halfFloor";
    case RoundingMode::kHalfExpand:
      return "halfExpand";
    case RoundingMode::kHalfTrunc:
      return "halfTrunc";
    case RoundingMode::kHalfEven:
      return "halfEven";
  }
  return "unknown";
}

// ── RoundingIncrement ─────────────────────────────────────────────────

TemporalResult<RoundingIncrement> RoundingIncrement::TryNew(
    uint32_t increment) noexcept {
  if (increment < 1 || increment > 1'000'000'000) {
    return TemporalError::Range(
        "roundingIncrement cannot be less than 1 or bigger than 10**9");
  }
  return RoundingIncrement(increment);
}

TemporalResult<RoundingIncrement> RoundingIncrement::TryFromF64(
    double value) noexcept {
  if (!std::isfinite(value)) {
    return TemporalError::Range("roundingIncrement must be finite");
  }
  // truncate toward zero.
  const double truncated = std::trunc(value);
  if (truncated < 1.0 || truncated > 1'000'000'000.0) {
    return TemporalError::Range(
        "roundingIncrement cannot be less than 1 or bigger than 10**9");
  }
  return RoundingIncrement(static_cast<uint32_t>(truncated));
}

TemporalResult<void> RoundingIncrement::Validate(uint64_t dividend,
                                                   bool inclusive) const noexcept {
  // 1/2: max = inclusive ? dividend : dividend - 1.
  const uint64_t max = inclusive ? dividend : dividend - 1;
  const uint64_t inc = static_cast<uint64_t>(value_);
  // 3.
  if (inc > max) {
    return TemporalError::Range("roundingIncrement exceeds maximum");
  }
  // 4.
  if (dividend % inc != 0) {
    return TemporalError::Range(
        "dividend is not divisible by roundingIncrement");
  }
  return {};
}

// ── ToStringRoundingOptions ───────────────────────────────────────────

namespace {

// Helper: 10^exp for 0..9. Mirrors upstream's `10_u32.pow(...)`.
uint32_t Pow10(uint32_t exp) noexcept {
  uint32_t r = 1;
  for (uint32_t i = 0; i < exp; ++i) {
    r *= 10;
  }
  return r;
}

}  // namespace

TemporalResult<ResolvedToStringRoundingOptions>
ToStringRoundingOptionsResolve(
    const ToStringRoundingOptions& options) noexcept {
  const RoundingMode rounding_mode =
      options.rounding_mode.value_or(RoundingMode::kTrunc);

  if (options.smallest_unit.has_value()) {
    const Unit u = *options.smallest_unit;
    Precision precision;
    Unit smallest_unit;
    switch (u) {
      case Unit::kMinute:
        precision.kind = Precision::Kind::kMinute;
        smallest_unit = Unit::kMinute;
        break;
      case Unit::kSecond:
        precision.kind = Precision::Kind::kDigit;
        precision.digits = 0;
        smallest_unit = Unit::kSecond;
        break;
      case Unit::kMillisecond:
        precision.kind = Precision::Kind::kDigit;
        precision.digits = 3;
        smallest_unit = Unit::kMillisecond;
        break;
      case Unit::kMicrosecond:
        precision.kind = Precision::Kind::kDigit;
        precision.digits = 6;
        smallest_unit = Unit::kMicrosecond;
        break;
      case Unit::kNanosecond:
        precision.kind = Precision::Kind::kDigit;
        precision.digits = 9;
        smallest_unit = Unit::kNanosecond;
        break;
      default:
        return TemporalError::Range(
            "smallestUnit must be a time unit (minute through nanosecond)");
    }
    return ResolvedToStringRoundingOptions{precision, smallest_unit,
                                            rounding_mode,
                                            RoundingIncrement::One()};
  }
  // smallest_unit is None — use precision.
  switch (options.precision.kind) {
    case Precision::Kind::kAuto:
      return ResolvedToStringRoundingOptions{
          Precision{Precision::Kind::kAuto, 0}, Unit::kNanosecond,
          rounding_mode, RoundingIncrement::One()};
    case Precision::Kind::kDigit: {
      const uint8_t d = options.precision.digits;
      if (d == 0) {
        return ResolvedToStringRoundingOptions{
            Precision{Precision::Kind::kDigit, 0}, Unit::kSecond,
            rounding_mode, RoundingIncrement::One()};
      }
      Unit smallest_unit;
      uint32_t exp;
      if (d <= 3) {
        smallest_unit = Unit::kMillisecond;
        exp = 3 - d;
      } else if (d <= 6) {
        smallest_unit = Unit::kMicrosecond;
        exp = 6 - d;
      } else if (d <= 9) {
        smallest_unit = Unit::kNanosecond;
        exp = 9 - d;
      } else {
        return TemporalError::Range(
            "fractional digits precision out of range (0..9)");
      }
      auto inc = RoundingIncrement::TryNew(Pow10(exp));
      if (!inc.ok()) {
        return inc.error();
      }
      return ResolvedToStringRoundingOptions{options.precision, smallest_unit,
                                              rounding_mode, inc.value()};
    }
    case Precision::Kind::kMinute:
      // Upstream: when smallest_unit is None, Minute precision falls
      // through to the catch-all. Match: return SmallestUnitNotTimeUnit.
      return TemporalError::Range(
          "smallestUnit must be a time unit (minute through nanosecond)");
  }
  return TemporalError::Range(
      "smallestUnit must be a time unit (minute through nanosecond)");
}

// ── ResolvedRoundingOptions ───────────────────────────────────────────

ResolvedRoundingOptions ResolvedRoundingOptionsFromToString(
    const ResolvedToStringRoundingOptions& options) noexcept {
  return ResolvedRoundingOptions{Unit::kAuto, options.smallest_unit,
                                  options.increment, options.rounding_mode};
}

namespace {

// Helper: upstream's `Option<Unit>::unwrap_unit_or` — treats Auto same
// as None.
Unit UnwrapUnitOr(std::optional<Unit> u, Unit fallback) noexcept {
  if (!u.has_value() || *u == Unit::kAuto) {
    return fallback;
  }
  return *u;
}

}  // namespace

TemporalResult<ResolvedRoundingOptions>
ResolvedRoundingOptionsFromDiffSettings(const DifferenceSettings& options,
                                         DifferenceOperation operation,
                                         UnitGroup unit_group,
                                         Unit fallback_largest,
                                         Unit fallback_smallest) noexcept {
  // 2. Validate largestUnit.
  auto v = UnitGroupValidateUnit(unit_group, options.largest_unit,
                                 std::optional<Unit>(Unit::kAuto));
  if (!v.ok()) {
    return v.error();
  }

  // 4. increment = options.increment.unwrap_or_default()
  const RoundingIncrement increment = options.increment.value_or(
      RoundingIncrement{});  // default = ONE
  // 5/6. roundingMode default = Trunc; Since negates.
  const RoundingMode rm_default = RoundingMode::kTrunc;
  RoundingMode rounding_mode =
      options.rounding_mode.value_or(rm_default);
  if (operation == DifferenceOperation::kSince) {
    rounding_mode = RoundingModeNegate(rounding_mode);
  }
  // 7. smallestUnit fallback.
  const Unit smallest_unit =
      options.smallest_unit.value_or(fallback_smallest);
  // 8. Validate smallestUnit.
  auto v_smallest =
      UnitGroupValidateUnit(unit_group, options.smallest_unit, std::nullopt);
  if (!v_smallest.ok()) {
    return v_smallest.error();
  }
  // 9. defaultLargestUnit = max(fallback_largest, smallestUnit).
  Unit default_largest_unit = fallback_largest;
  if (smallest_unit > default_largest_unit) {
    default_largest_unit = smallest_unit;
  }
  // 10/11. resolve largestUnit.
  Unit largest_unit =
      UnwrapUnitOr(options.largest_unit, default_largest_unit);
  if (largest_unit == Unit::kAuto) {
    largest_unit = default_largest_unit;
  }
  if (largest_unit < smallest_unit) {
    return TemporalError::Range(
        "smallestUnit is larger than largestUnit");
  }
  // 12/13. validate increment against unit's max.
  if (auto max = UnitMaximumRoundingIncrement(smallest_unit);
      max.has_value()) {
    auto vi = increment.Validate(static_cast<uint64_t>(*max), false);
    if (!vi.ok()) {
      return vi.error();
    }
  }
  return ResolvedRoundingOptions{largest_unit, smallest_unit, increment,
                                  rounding_mode};
}

TemporalResult<ResolvedRoundingOptions> ResolvedRoundingOptionsFromDateTime(
    const RoundingOptions& options) noexcept {
  const RoundingIncrement increment =
      options.increment.value_or(RoundingIncrement{});
  const RoundingMode rounding_mode =
      options.rounding_mode.value_or(RoundingMode::kHalfExpand);
  auto su = UnitGroupValidateRequiredUnit(
      UnitGroup::kTime, options.smallest_unit,
      std::optional<Unit>(Unit::kDay));
  if (!su.ok()) {
    return su.error();
  }
  const Unit smallest_unit = su.value();
  uint64_t maximum;
  bool inclusive;
  if (smallest_unit == Unit::kDay) {
    maximum = 1;
    inclusive = true;
  } else {
    auto m = UnitMaximumRoundingIncrement(smallest_unit);
    if (!m.has_value()) {
      return TemporalError::Range(
          "smallestUnit must be a time unit");
    }
    maximum = *m;
    inclusive = false;
  }
  auto vi = increment.Validate(maximum, inclusive);
  if (!vi.ok()) {
    return vi.error();
  }
  return ResolvedRoundingOptions{Unit::kAuto, smallest_unit, increment,
                                  rounding_mode};
}

TemporalResult<ResolvedRoundingOptions> ResolvedRoundingOptionsFromTime(
    const RoundingOptions& options) noexcept {
  if (!options.smallest_unit.has_value()) {
    return TemporalError::Range("smallestUnit is required");
  }
  const Unit smallest_unit = *options.smallest_unit;
  const RoundingIncrement increment =
      options.increment.value_or(RoundingIncrement::One());
  const RoundingMode rounding_mode =
      options.rounding_mode.value_or(RoundingMode::kHalfExpand);
  auto m = UnitMaximumRoundingIncrement(smallest_unit);
  if (!m.has_value()) {
    return TemporalError::Range("smallestUnit must be a time unit");
  }
  auto vi = increment.Validate(static_cast<uint64_t>(*m), false);
  if (!vi.ok()) {
    return vi.error();
  }
  return ResolvedRoundingOptions{Unit::kAuto, smallest_unit, increment,
                                  rounding_mode};
}

TemporalResult<ResolvedRoundingOptions> ResolvedRoundingOptionsFromInstant(
    const RoundingOptions& options) noexcept {
  const RoundingIncrement increment =
      options.increment.value_or(RoundingIncrement{});
  const RoundingMode rounding_mode =
      options.rounding_mode.value_or(RoundingMode::kHalfExpand);
  auto su = UnitGroupValidateRequiredUnit(UnitGroup::kTime,
                                            options.smallest_unit, std::nullopt);
  if (!su.ok()) {
    return su.error();
  }
  const Unit smallest_unit = su.value();
  uint64_t maximum;
  switch (smallest_unit) {
    case Unit::kHour:
      maximum = 24;
      break;
    case Unit::kMinute:
      maximum = 24ULL * 60;
      break;
    case Unit::kSecond:
      maximum = 24ULL * 3600;
      break;
    case Unit::kMillisecond:
      maximum = static_cast<uint64_t>(kMsPerDay);
      break;
    case Unit::kMicrosecond:
      maximum = static_cast<uint64_t>(kMsPerDay) * 1000;
      break;
    case Unit::kNanosecond:
      maximum = static_cast<uint64_t>(kNsPerDay);
      break;
    default:
      return TemporalError::Range(
          "Round-to unit is not valid for an Instant");
  }
  auto vi = increment.Validate(maximum, true);
  if (!vi.ok()) {
    return vi.error();
  }
  return ResolvedRoundingOptions{Unit::kAuto, smallest_unit, increment,
                                  rounding_mode};
}

// ── Display* ──────────────────────────────────────────────────────────

TemporalResult<DisplayCalendar> DisplayCalendarFromString(
    std::string_view s) noexcept {
  if (s == "auto") return DisplayCalendar::kAuto;
  if (s == "always") return DisplayCalendar::kAlways;
  if (s == "never") return DisplayCalendar::kNever;
  if (s == "critical") return DisplayCalendar::kCritical;
  return TemporalError::Range("calendar name option is invalid");
}

std::string_view DisplayCalendarToString(DisplayCalendar d) noexcept {
  switch (d) {
    case DisplayCalendar::kAuto:
      return "auto";
    case DisplayCalendar::kAlways:
      return "always";
    case DisplayCalendar::kNever:
      return "never";
    case DisplayCalendar::kCritical:
      return "critical";
  }
  return "unknown";
}

TemporalResult<DisplayOffset> DisplayOffsetFromString(
    std::string_view s) noexcept {
  if (s == "auto") return DisplayOffset::kAuto;
  if (s == "never") return DisplayOffset::kNever;
  return TemporalError::Range("offset option is invalid");
}

std::string_view DisplayOffsetToString(DisplayOffset d) noexcept {
  switch (d) {
    case DisplayOffset::kAuto:
      return "auto";
    case DisplayOffset::kNever:
      return "never";
  }
  return "unknown";
}

TemporalResult<DisplayTimeZone> DisplayTimeZoneFromString(
    std::string_view s) noexcept {
  if (s == "auto") return DisplayTimeZone::kAuto;
  if (s == "never") return DisplayTimeZone::kNever;
  if (s == "critical") return DisplayTimeZone::kCritical;
  return TemporalError::Range("time zone name option is invalid");
}

std::string_view DisplayTimeZoneToString(DisplayTimeZone d) noexcept {
  switch (d) {
    case DisplayTimeZone::kAuto:
      return "auto";
    case DisplayTimeZone::kNever:
      return "never";
    case DisplayTimeZone::kCritical:
      return "critical";
  }
  return "unknown";
}

}  // namespace temporal
}  // namespace socketsecurity
}  // namespace node
