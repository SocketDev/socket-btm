// Compat shim: temporal_rs::Instant — heap-owned wrapper around
// node::socketsecurity::temporal::Instant. V8's call sites operate
// on `std::unique_ptr<Instant>` per upstream's diplomat conventions,
// so this class is non-copyable/non-movable; callers receive
// `unique_ptr` from the static factories.
//
// `temporal_rs::` is preserved as the V8-facing namespace name even
// though there's no Rust in this layer — see README.md for the
// rationale (it's the ABI shape V8's js-temporal-objects.cc was
// generated against; renaming would mean a ~459-line V8 patch).
//
// Activated: try_new, from_epoch_milliseconds, from_utf8, from_utf16,
// epoch_milliseconds, epoch_nanoseconds, equals, compare, clone,
// to_zoned_date_time_iso{,_with_provider}, to_ixdtf_string,
// to_ixdtf_string_with_provider, add (templated), since_dur/until_dur
// (templated).
//
// Still pending: round (rounding-tail wiring), since/until (the
// non-templated V8-facing variants that need a Duration-arithmetic
// pass + smallest_unit rounding), add/subtract on the V8-facing
// non-templated paths. These return TemporalError::Range
// "not yet implemented" so V8 surfaces a clean RangeError until the
// Duration arithmetic phase lands.

#ifndef TEMPORAL_RS_COMPAT_INSTANT_HPP_
#define TEMPORAL_RS_COMPAT_INSTANT_HPP_

#include <cstdint>
#include <memory>
#include <optional>
#include <string>
#include <string_view>

#include "socketsecurity/temporal/ixdtf_writer.h"
#include "socketsecurity/temporal/parse.h"
#include "socketsecurity/temporal/temporal.h"
#include "socketsecurity/temporal/time_zone.h"
#include "temporal_rs/DifferenceSettings.hpp"
#include "temporal_rs/Duration.hpp"
#include "temporal_rs/I128Nanoseconds.hpp"
#include "temporal_rs/Provider.hpp"
#include "temporal_rs/RoundingOptions.hpp"
#include "temporal_rs/TemporalError.hpp"
#include "temporal_rs/TimeZone.hpp"
#include "temporal_rs/ToStringRoundingOptions.hpp"
#include "temporal_rs/diplomat_runtime.hpp"

namespace temporal_rs {

// Forward decls for types this header doesn't depend on heavily.
class Duration;
struct DifferenceSettings;
struct ToStringRoundingOptions;
struct TimeZone;
class ZonedDateTime;
class Provider;

class Instant {
 public:
  // ── Static factories ──────────────────────────────────────────────

  static diplomat::result<std::unique_ptr<Instant>, TemporalError> try_new(
      I128Nanoseconds ns) {
    auto inner = ::node::socketsecurity::temporal::Instant{};
    inner.epoch_nanoseconds = ns.ToInfra();
    if (!inner.IsValid()) {
      return diplomat::Err<TemporalError>(TemporalError{
          ErrorKind::Range, "Instant epoch nanoseconds out of range"});
    }
    return diplomat::Ok<std::unique_ptr<Instant>>(
        std::unique_ptr<Instant>(new Instant(inner)));
  }

  static diplomat::result<std::unique_ptr<Instant>, TemporalError>
  from_epoch_milliseconds(int64_t epoch_milliseconds) {
    // ms → ns. Bound-check against the spec's IsValidEpochNanoseconds
    // via inner.IsValid() rather than re-computing here.
    auto inner = ::node::socketsecurity::temporal::Instant{};
    inner.epoch_nanoseconds =
        ::node::socketsecurity::temporal::Int128(epoch_milliseconds) *
        ::node::socketsecurity::temporal::Int128(int64_t{1'000'000});
    if (!inner.IsValid()) {
      return diplomat::Err<TemporalError>(TemporalError{
          ErrorKind::Range, "Instant epoch milliseconds out of range"});
    }
    return diplomat::Ok<std::unique_ptr<Instant>>(
        std::unique_ptr<Instant>(new Instant(inner)));
  }

  static diplomat::result<std::unique_ptr<Instant>, TemporalError> from_utf8(
      std::string_view s) {
    ::node::socketsecurity::temporal::Instant inner{};
    auto status = ::node::socketsecurity::temporal::ParseInstantString(
        s, &inner);
    if (status != ::node::socketsecurity::temporal::ParseStatus::kOk ||
        !inner.IsValid()) {
      return diplomat::Err<TemporalError>(
          TemporalError{ErrorKind::Range, "Invalid Instant string"});
    }
    return diplomat::Ok<std::unique_ptr<Instant>>(
        std::unique_ptr<Instant>(new Instant(inner)));
  }

  static diplomat::result<std::unique_ptr<Instant>, TemporalError>
  from_utf16(std::u16string_view s) {
    // Transcode UTF-16 → UTF-8 at the boundary, then route through
    // from_utf8. Temporal IXDTF input is ASCII only in practice, so
    // the transcoding is essentially a narrowing copy. Anything
    // non-ASCII is a parse error anyway.
    std::string narrow;
    narrow.reserve(s.size());
    for (char16_t c : s) {
      if (c > 0x7F) {
        return diplomat::Err<TemporalError>(TemporalError{
            ErrorKind::Range, "Non-ASCII character in Instant string"});
      }
      narrow.push_back(static_cast<char>(c));
    }
    return from_utf8(narrow);
  }

  // ── Field accessors (const, no failure) ───────────────────────────

  int64_t epoch_milliseconds() const {
    using ::node::socketsecurity::temporal::Int128;
    // Spec uses floor(epochNs / 10^6). C++ `/` truncates toward zero —
    // `-500000ns / 1_000_000 == 0`, but the spec wants `-1` (one ms
    // before epoch). FloorDiv restores spec.
    Int128 ms = inner_.epoch_nanoseconds.FloorDiv(Int128(int64_t{1'000'000}));
    return ms.ToInt64();
  }

  I128Nanoseconds epoch_nanoseconds() const {
    return I128Nanoseconds::FromInfra(inner_.epoch_nanoseconds);
  }

  // ── Comparison ────────────────────────────────────────────────────

  int8_t compare(const Instant& other) const {
    if (inner_.epoch_nanoseconds < other.inner_.epoch_nanoseconds) {
      return -1;
    }
    if (inner_.epoch_nanoseconds > other.inner_.epoch_nanoseconds) {
      return 1;
    }
    return 0;
  }

  bool equals(const Instant& other) const {
    return inner_.epoch_nanoseconds == other.inner_.epoch_nanoseconds;
  }

  // ── Clone ─────────────────────────────────────────────────────────

  std::unique_ptr<Instant> clone() const {
    return std::unique_ptr<Instant>(new Instant(inner_));
  }

  // ── Rounding ───────────────────────────────────────────────────
  //
  // 1:1 from upstream instant.rs:238-269 `round_instant`. Rounds the
  // epoch-ns to a multiple of `increment * nsPerUnit` per the
  // requested mode. Only time units (hour/minute/second/ms/us/ns) are
  // valid; day/year/week/month return Range per spec.
  diplomat::result<std::unique_ptr<Instant>, TemporalError> round(
      const RoundingOptions& options) const {
    using Unit = ::node::socketsecurity::temporal::Unit;
    using RoundingMode = ::node::socketsecurity::temporal::RoundingMode;
    using UnsignedRoundingMode =
        ::node::socketsecurity::temporal::UnsignedRoundingMode;
    using ::node::socketsecurity::temporal::Int128;
    using ::node::socketsecurity::temporal::RoundingModeGetUnsigned;

    // Per spec: smallest_unit is required for Instant.round.
    if (!options.smallest_unit.has_value()) {
      return diplomat::Err<TemporalError>(TemporalError{
          ErrorKind::Range,
          "Instant.round requires smallestUnit"});
    }
    const Unit unit = options.smallest_unit->ToInfra();
    uint64_t unit_ns = 0;
    switch (unit) {
      case Unit::kHour:        unit_ns = 3'600'000'000'000ULL; break;
      case Unit::kMinute:      unit_ns =    60'000'000'000ULL; break;
      case Unit::kSecond:      unit_ns =     1'000'000'000ULL; break;
      case Unit::kMillisecond: unit_ns =         1'000'000ULL; break;
      case Unit::kMicrosecond: unit_ns =             1'000ULL; break;
      case Unit::kNanosecond:  unit_ns =                 1ULL; break;
      default:
        return diplomat::Err<TemporalError>(TemporalError{
            ErrorKind::Range,
            "Instant.round smallestUnit must be 'hour' or smaller"});
    }
    const uint64_t increment = options.increment.value_or(1u);
    if (increment == 0) {
      return diplomat::Err<TemporalError>(TemporalError{
          ErrorKind::Range, "Instant.round roundingIncrement must be > 0"});
    }
    const RoundingMode mode =
        options.rounding_mode.has_value()
            ? options.rounding_mode->ToInfra()
            : RoundingMode::kHalfExpand;
    const Int128 inc(static_cast<int64_t>(increment * unit_ns));

    // Round epoch_ns to the nearest multiple of `inc` per `mode`,
    // matching the algorithm in iso.cc:420-460 (RoundIsoTime tail).
    const Int128 quantity = inner_.epoch_nanoseconds;
    const bool sign = quantity >= Int128(0);
    const UnsignedRoundingMode unsigned_mode =
        RoundingModeGetUnsigned(mode, sign);
    Int128 abs_q = sign ? quantity : -quantity;
    Int128 r1 = abs_q / inc;
    Int128 rem = abs_q % inc;
    Int128 rounded;
    if (rem == Int128(0) || unsigned_mode == UnsignedRoundingMode::kZero) {
      rounded = r1;
    } else if (unsigned_mode == UnsignedRoundingMode::kInfinity) {
      rounded = r1 + Int128(1);
    } else {
      Int128 twice_rem = rem + rem;
      if (twice_rem < inc) {
        rounded = r1;
      } else if (twice_rem > inc) {
        rounded = r1 + Int128(1);
      } else {
        switch (unsigned_mode) {
          case UnsignedRoundingMode::kHalfZero:     rounded = r1; break;
          case UnsignedRoundingMode::kHalfInfinity: rounded = r1 + Int128(1); break;
          case UnsignedRoundingMode::kHalfEven: {
            Int128 mod = r1 % Int128(2);
            rounded = (mod == Int128(0)) ? r1 : r1 + Int128(1);
            break;
          }
          default: rounded = r1; break;
        }
      }
    }
    if (!sign) rounded = -rounded;
    const Int128 rounded_ns = rounded * inc;
    ::node::socketsecurity::temporal::Instant out{};
    out.epoch_nanoseconds = rounded_ns;
    if (!out.IsValid()) {
      return diplomat::Err<TemporalError>(TemporalError{
          ErrorKind::Range,
          "Instant.round result exceeds valid epoch range"});
    }
    return diplomat::Ok<std::unique_ptr<Instant>>(Instant::FromInfra(out));
  }

  // ── ZDT projection ─────────────────────────────────────────────
  //
  // 1:1 from upstream instant.rs:412 `to_zoned_date_time_iso_with_provider`:
  // construct a ZonedDateTime{this, time_zone, Calendar::ISO}. The
  // upstream provider arg drives DST/calendar resolution at later
  // calls (e.g. ZonedDateTime::to_plain_date_time) — at construction
  // time it's unused. The non-provider variant below routes through
  // this with a default-constructed Provider.
  //
  // Bodies are defined at the tail of this header (after class
  // ZonedDateTime is fully visible via the include cycle resolving)
  // because they call ZonedDateTime::FromInfra.
  inline diplomat::result<std::unique_ptr<ZonedDateTime>, TemporalError>
  to_zoned_date_time_iso(const TimeZone& tz) const;

  inline diplomat::result<std::unique_ptr<ZonedDateTime>, TemporalError>
  to_zoned_date_time_iso_with_provider(const TimeZone& tz,
                                         const Provider& /*p*/) const;

  // ── Arithmetic ─────────────────────────────────────────────────
  //
  // Routes through the temporal-infra free-function arithmetic surface
  // (AddDuration / InstantSince) which takes / returns Duration value
  // types. The forward-declared `Duration` shim is heap-owned, so this
  // header only declares the methods; bodies live in
  // include/temporal_rs/_arith_inline.hpp (included after Duration.hpp
  // is in scope) to avoid a circular dependency between Instant.hpp
  // and Duration.hpp.

  // Activated below (after Duration.hpp is included by the consumer).
  // Kept declared here so V8's call sites compile.
  template <class D>
  diplomat::result<std::unique_ptr<Instant>, ::temporal_rs::TemporalError> add(
      const D& duration) const {
    auto out_inner = ::node::socketsecurity::temporal::AddDuration(
        inner_, duration.ToInfra());
    if (!out_inner.IsValid()) {
      return diplomat::Err<::temporal_rs::TemporalError>(
          ::temporal_rs::TemporalError{
              ::temporal_rs::ErrorKind::Range,
              "Instant arithmetic produced out-of-range value"});
    }
    return diplomat::Ok<std::unique_ptr<Instant>>(
        std::unique_ptr<Instant>(new Instant(out_inner)));
  }

  template <class D>
  diplomat::result<std::unique_ptr<Instant>, ::temporal_rs::TemporalError>
  subtract(const D& duration) const {
    auto out_inner = ::node::socketsecurity::temporal::AddDuration(
        inner_, ::node::socketsecurity::temporal::DurationNegated(
                    duration.ToInfra()));
    if (!out_inner.IsValid()) {
      return diplomat::Err<::temporal_rs::TemporalError>(
          ::temporal_rs::TemporalError{
              ::temporal_rs::ErrorKind::Range,
              "Instant arithmetic produced out-of-range value"});
    }
    return diplomat::Ok<std::unique_ptr<Instant>>(
        std::unique_ptr<Instant>(new Instant(out_inner)));
  }

  // V8-facing since/until. Upstream's instant.rs:360-367 routes through
  // `diff_instant(op, other, settings)` which (1) resolves
  // DifferenceSettings via ResolvedRoundingOptionsFromDiffSettings,
  // (2) computes the raw ns delta via TimeDuration::from_nanosecond_
  // difference, (3) rounds via TimeDuration::Round to the smallest
  // unit, then (4) balances into a Duration up to the largest unit.
  // Defaults (per instant.rs:213-218): UnitGroup::Time, fallback
  // largest=Second, fallback smallest=Nanosecond, rounding mode=Trunc.
  //
  // We can't reach ResolvedRoundingOptionsFromDiffSettings from this
  // header without pulling options.h in here (the include order is
  // intentionally minimal). Instead, compute the raw int128 ns delta
  // directly — that's the *unrounded* answer, which is correct under
  // the default Trunc rounding mode + increment=1, and balance it into
  // {seconds, milliseconds, microseconds, nanoseconds} per the
  // largestUnit=Second default. Non-default settings (largestUnit
  // ≠ Second, rounding != Trunc, increment > 1, smallestUnit
  // ≠ Nanosecond) are not yet supported and still surface a clean
  // RangeError so callers see the limitation immediately.
  diplomat::result<std::unique_ptr<Duration>, TemporalError>
  until(const Instant& other, DifferenceSettings settings) const {
    return diff(other, settings, /*negate=*/false);
  }

  diplomat::result<std::unique_ptr<Duration>, TemporalError>
  since(const Instant& other, DifferenceSettings settings) const {
    return diff(other, settings, /*negate=*/true);
  }

 private:
  diplomat::result<std::unique_ptr<Duration>, TemporalError> diff(
      const Instant& other, const DifferenceSettings& settings,
      bool negate) const {
    // Reject non-default settings rather than silently producing the
    // wrong answer.
    if (settings.smallest_unit.has_value() &&
        settings.smallest_unit->ToInfra() !=
            ::node::socketsecurity::temporal::Unit::kNanosecond) {
      return diplomat::Err<::temporal_rs::TemporalError>(::temporal_rs::TemporalError{
          ::temporal_rs::ErrorKind::Range,
          "Instant.until/since smallestUnit other than 'nanosecond' "
          "is not yet supported"});
    }
    if (settings.rounding_mode.has_value() &&
        settings.rounding_mode->ToInfra() !=
            ::node::socketsecurity::temporal::RoundingMode::kTrunc) {
      return diplomat::Err<::temporal_rs::TemporalError>(::temporal_rs::TemporalError{
          ::temporal_rs::ErrorKind::Range,
          "Instant.until/since roundingMode other than 'trunc' "
          "is not yet supported"});
    }
    if (settings.increment.has_value() && *settings.increment != 1) {
      return diplomat::Err<::temporal_rs::TemporalError>(::temporal_rs::TemporalError{
          ::temporal_rs::ErrorKind::Range,
          "Instant.until/since roundingIncrement > 1 is not yet "
          "supported"});
    }

    // Determine largestUnit. Default is Second per upstream
    // instant.rs:217. The Instant API rejects Year/Week/Month per
    // spec but accepts Day and below.
    using Unit = ::node::socketsecurity::temporal::Unit;
    Unit largest = Unit::kSecond;
    if (settings.largest_unit.has_value()) {
      largest = settings.largest_unit->ToInfra();
      if (largest == Unit::kAuto) {
        largest = Unit::kSecond;
      }
      if (largest != Unit::kDay && largest != Unit::kHour &&
          largest != Unit::kMinute && largest != Unit::kSecond &&
          largest != Unit::kMillisecond && largest != Unit::kMicrosecond &&
          largest != Unit::kNanosecond) {
        return diplomat::Err<::temporal_rs::TemporalError>(::temporal_rs::TemporalError{
            ::temporal_rs::ErrorKind::Range,
            "Instant.until/since largestUnit must be 'day' or smaller"});
      }
    }

    // Compute the int128 nanosecond delta. `until` returns
    // (other - self); `since` is the negation.
    using NativeInt128 =
        decltype(other.inner_.epoch_nanoseconds.value);
    NativeInt128 delta_ns =
        other.inner_.epoch_nanoseconds.value - inner_.epoch_nanoseconds.value;
    if (negate) {
      delta_ns = -delta_ns;
    }

    // Guard against int64 narrowing at the chosen largestUnit. Valid
    // Instant range is ±8.64e21 ns. After dividing by the unit size,
    // the largest field of the resulting Duration (a `double` per
    // spec, but we materialize through int64 here) must fit:
    //   - Day:    8.64e21 / 86_400_000_000_000 = 1e8  ✓
    //   - Hour:   8.64e21 / 3_600_000_000_000  = 2.4e9  ✓
    //   - Minute: 8.64e21 / 60_000_000_000     = 1.44e11  ✓
    //   - Second: 8.64e21 / 1_000_000_000      = 8.64e12  ✓
    //   - Ms:     8.64e21 / 1_000_000          = 8.64e15  ✓
    //   - Us:     8.64e21 / 1_000              = 8.64e18  ✗ overflows int64
    //   - Ns:     8.64e21                       ✗ overflows int64
    // Reject the two overflowing cases explicitly rather than silently
    // truncating. Full int128-carry support is its own change.
    constexpr NativeInt128 kInt64Max = NativeInt128{INT64_MAX};
    if (largest == Unit::kMicrosecond) {
      const NativeInt128 abs_delta = delta_ns < 0 ? -delta_ns : delta_ns;
      if (abs_delta / NativeInt128{1000} > kInt64Max) {
        return diplomat::Err<TemporalError>(TemporalError{
            ErrorKind::Range,
            "Instant.until/since delta exceeds int64 microseconds at "
            "the requested largestUnit; use 'millisecond' or larger"});
      }
    } else if (largest == Unit::kNanosecond) {
      const NativeInt128 abs_delta = delta_ns < 0 ? -delta_ns : delta_ns;
      if (abs_delta > kInt64Max) {
        return diplomat::Err<TemporalError>(TemporalError{
            ErrorKind::Range,
            "Instant.until/since delta exceeds int64 nanoseconds at "
            "the requested largestUnit; use 'microsecond' or larger"});
      }
    }

    // Balance per the spec's BalanceTimeDuration(ns, largestUnit).
    // C++ integer division truncates toward zero — same as the spec's
    // R(remainder / divisor) for negative values — so the per-field
    // signs naturally agree with the overall delta sign.
    constexpr NativeInt128 kNsPerUs = 1000;
    constexpr NativeInt128 kNsPerMs = 1000 * kNsPerUs;
    constexpr NativeInt128 kNsPerSec = 1000 * kNsPerMs;
    constexpr NativeInt128 kNsPerMin = 60 * kNsPerSec;
    constexpr NativeInt128 kNsPerHour = 60 * kNsPerMin;
    constexpr NativeInt128 kNsPerDay = 24 * kNsPerHour;

    int64_t days = 0, hours = 0, minutes = 0, seconds = 0;
    int64_t ms = 0, us = 0, ns = 0;
    NativeInt128 remainder = delta_ns;
    if (largest == Unit::kDay) {
      days = static_cast<int64_t>(remainder / kNsPerDay);
      remainder -= NativeInt128(days) * kNsPerDay;
    }
    if (largest == Unit::kDay || largest == Unit::kHour) {
      hours = static_cast<int64_t>(remainder / kNsPerHour);
      remainder -= NativeInt128(hours) * kNsPerHour;
    }
    if (largest == Unit::kDay || largest == Unit::kHour ||
        largest == Unit::kMinute) {
      minutes = static_cast<int64_t>(remainder / kNsPerMin);
      remainder -= NativeInt128(minutes) * kNsPerMin;
    }
    if (largest == Unit::kDay || largest == Unit::kHour ||
        largest == Unit::kMinute || largest == Unit::kSecond) {
      seconds = static_cast<int64_t>(remainder / kNsPerSec);
      remainder -= NativeInt128(seconds) * kNsPerSec;
    }
    if (largest != Unit::kMicrosecond && largest != Unit::kNanosecond) {
      ms = static_cast<int64_t>(remainder / kNsPerMs);
      remainder -= NativeInt128(ms) * kNsPerMs;
    }
    if (largest != Unit::kNanosecond) {
      us = static_cast<int64_t>(remainder / kNsPerUs);
      remainder -= NativeInt128(us) * kNsPerUs;
    }
    ns = static_cast<int64_t>(remainder);

    auto d = ::node::socketsecurity::temporal::DurationCreate(
        /*years=*/0, /*months=*/0, /*weeks=*/0, days,
        hours, minutes, seconds, ms,
        static_cast<double>(us), static_cast<double>(ns));
    return diplomat::Ok<std::unique_ptr<Duration>>(Duration::FromInfra(d));
  }

 public:

  // 1:1 from upstream instant.rs:420 / :431.
  diplomat::result<std::string, TemporalError>
  to_ixdtf_string_with_provider(std::optional<TimeZone> zone,
                                 ToStringRoundingOptions options,
                                 const Provider& /*p*/) const {
    auto resolved =
        ::node::socketsecurity::temporal::ToStringRoundingOptionsResolve(
            options.ToInfra());
    if (!resolved.ok()) {
      return diplomat::Err<TemporalError>(
          TemporalError::FromInfra(resolved.error()));
    }
    // Some(zone) branch needs offset resolution via get_offset_nanos_for
    // + nanoseconds_to_formattable_offset_minutes. Until that lands,
    // refuse rather than silently emit `Z`-suffixed output for a caller
    // that asked for a specific zone.
    if (zone.has_value()) {
      return diplomat::Err<TemporalError>(TemporalError{
          ErrorKind::Range,
          "Instant.toString(timeZone) requires provider integration"});
    }
    // Upstream rounds the instant via round_instant BEFORE feeding
    // GetIsoDateTimeFor. Without that, precision-truncation
    // in formatting doesn't match round-then-format semantics — a
    // `2026-05-08T12:34:56.999999999Z` rounded to seconds with
    // halfExpand should emit `...:57`, not `...:56`. RoundInstant lands
    // alongside the calendar/provider integration phase.
    if (resolved.value().smallest_unit !=
        ::node::socketsecurity::temporal::Unit::kNanosecond) {
      return diplomat::Err<TemporalError>(TemporalError{
          ErrorKind::Range,
          "Instant.toString rounding to non-nanosecond units requires "
          "RoundInstant integration"});
    }
    // No-zone path: 1:1 with upstream's `with_z(DisplayOffset::Auto)`
    // else-branch. Routes through UTC since the instant is already
    // anchored at UTC.
    auto utc = ::node::socketsecurity::temporal::TimeZone::Utc();
    auto datetime = utc.GetIsoDateTimeFor(inner_);
    if (!datetime.ok()) {
      return diplomat::Err<TemporalError>(
          TemporalError::FromInfra(datetime.error()));
    }
    return diplomat::Ok<std::string>(
        ::node::socketsecurity::temporal::IxdtfStringBuilder()
            .WithDate(datetime.value().date)
            .WithTime(datetime.value().time, resolved.value().precision)
            .WithZ(::node::socketsecurity::temporal::DisplayOffset::kAuto)
            .Build());
  }

  // ── Bridges ────────────────────────────────────────────────────

  const ::node::socketsecurity::temporal::Instant& ToInfra() const {
    return inner_;
  }

  static std::unique_ptr<Instant> FromInfra(
      const ::node::socketsecurity::temporal::Instant& inner) {
    return std::unique_ptr<Instant>(new Instant(inner));
  }

  // ── Forbidden ops (mirrors upstream's deletion list) ──────────────
  Instant() = delete;
  Instant(const Instant&) = delete;
  Instant(Instant&&) noexcept = delete;
  Instant& operator=(const Instant&) = delete;
  Instant& operator=(Instant&&) noexcept = delete;

 private:
  explicit Instant(::node::socketsecurity::temporal::Instant inner)
      : inner_(inner) {}

  ::node::socketsecurity::temporal::Instant inner_;
};

// ── ZonedDateTime member-definitions that depend on Instant ───────
//
// `ZonedDateTime::to_instant()` is declared in ZonedDateTime.hpp but
// defined here. The cycle Instant.hpp → Duration.hpp → RelativeTo.hpp
// → ZonedDateTime.hpp re-enters Instant.hpp (guard set, skip) while
// `class Instant` is mid-parse upstream. Defining at the bottom of
// ZonedDateTime.hpp doesn't help either — Instant is still only
// forward-declared in that scope. Defining here at the tail of
// Instant.hpp guarantees both `class Instant` (just above) and
// `class ZonedDateTime` (parsed earlier in the cycle) are visible.
inline std::unique_ptr<Instant> ZonedDateTime::to_instant() const {
  // 1:1 from upstream zoned_date_time.rs `to_instant`: returns the
  // inner instant by value. The previous body returned nullptr which
  // would crash V8 callers on deref.
  return Instant::FromInfra(inner_.instant);
}

// ── Instant::to_zoned_date_time_iso{,_with_provider} ───────────────
//
// 1:1 from upstream instant.rs:412 (with-provider) and
// builtins/compiled/instant.rs:32 (no-provider routes through
// with-provider + default TZ_PROVIDER). Construction is trivial —
// `ZonedDateTime{this->inner_, time_zone, Calendar::ISO}` — because
// DST/calendar resolution happens lazily at later calls on the ZDT
// (e.g. `to_plain_date_time`), not at construction.
//
// Defined at the bottom of Instant.hpp (after ZonedDateTime is
// fully visible via the cycle unwinding) for the same reason as
// to_instant above.
inline diplomat::result<std::unique_ptr<ZonedDateTime>, TemporalError>
Instant::to_zoned_date_time_iso(const TimeZone& tz) const {
  ::node::socketsecurity::temporal::ZonedDateTime inner{
      inner_,
      tz.ToInfra(),
      ::node::socketsecurity::temporal::Calendar::Iso(),
  };
  return diplomat::Ok<std::unique_ptr<ZonedDateTime>>(
      ZonedDateTime::FromInfra(inner));
}

inline diplomat::result<std::unique_ptr<ZonedDateTime>, TemporalError>
Instant::to_zoned_date_time_iso_with_provider(const TimeZone& tz,
                                                const Provider& /*p*/) const {
  return to_zoned_date_time_iso(tz);
}

}  // namespace temporal_rs

#endif  // TEMPORAL_RS_COMPAT_INSTANT_HPP_
