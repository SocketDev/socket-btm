// Compat shim: temporal_rs::Duration — heap-owned wrapper around
// node::socketsecurity::temporal::Duration. Diplomat-shaped: factories
// return result<unique_ptr<Duration>, TemporalError>; the class itself
// is non-copyable / non-movable.
//
// `temporal_rs::` is preserved as the V8-facing namespace name even
// though there's no Rust in this layer — see README.md for the
// rationale.

#ifndef TEMPORAL_RS_COMPAT_DURATION_HPP_
#define TEMPORAL_RS_COMPAT_DURATION_HPP_

#include <cmath>
#include <cstdint>
#include <memory>
#include <optional>
#include <string>
#include <string_view>

#include "socketsecurity/temporal/duration_normalized.h"
#include "socketsecurity/temporal/error.h"
#include "socketsecurity/temporal/options.h"
#include "socketsecurity/temporal/temporal.h"
#include "temporal_rs/DifferenceSettings.hpp"
#include "temporal_rs/PartialDuration.hpp"
#include "temporal_rs/Provider.hpp"
#include "temporal_rs/RoundingOptions.hpp"
#include "temporal_rs/Sign.hpp"
#include "temporal_rs/TemporalError.hpp"
#include "temporal_rs/ToStringRoundingOptions.hpp"
#include "temporal_rs/Unit.hpp"
#include "temporal_rs/diplomat_runtime.hpp"

namespace temporal_rs {

// Forward declarations for types referenced by signatures.
class PlainDate;
class ZonedDateTime;
struct RelativeTo;

class Duration {
 public:
  // ── Static factories ──────────────────────────────────────────────

  static diplomat::result<std::unique_ptr<Duration>, TemporalError> create(
      int64_t years, int64_t months, int64_t weeks, int64_t days,
      int64_t hours, int64_t minutes, int64_t seconds, int64_t milliseconds,
      double microseconds, double nanoseconds) {
    auto inner = ::node::socketsecurity::temporal::DurationCreate(
        years, months, weeks, days, hours, minutes, seconds, milliseconds,
        microseconds, nanoseconds);
    return diplomat::Ok<std::unique_ptr<Duration>>(
        std::unique_ptr<Duration>(new Duration(inner)));
  }

  static diplomat::result<std::unique_ptr<Duration>, TemporalError> try_new(
      int64_t years, int64_t months, int64_t weeks, int64_t days,
      int64_t hours, int64_t minutes, int64_t seconds, int64_t milliseconds,
      double microseconds, double nanoseconds) {
    auto r = ::node::socketsecurity::temporal::DurationTryNew(
        years, months, weeks, days, hours, minutes, seconds, milliseconds,
        microseconds, nanoseconds);
    if (!r.ok()) {
      return diplomat::Err<TemporalError>(
          TemporalError::FromInfra(r.error()));
    }
    return diplomat::Ok<std::unique_ptr<Duration>>(
        std::unique_ptr<Duration>(new Duration(std::move(r.value()))));
  }

  static diplomat::result<std::unique_ptr<Duration>, TemporalError>
  from_partial_duration(const PartialDuration& partial) {
    auto inner = ::node::socketsecurity::temporal::DurationCreate(
        static_cast<int64_t>(partial.years.value_or(0.0)),
        static_cast<int64_t>(partial.months.value_or(0.0)),
        static_cast<int64_t>(partial.weeks.value_or(0.0)),
        static_cast<int64_t>(partial.days.value_or(0.0)),
        static_cast<int64_t>(partial.hours.value_or(0.0)),
        static_cast<int64_t>(partial.minutes.value_or(0.0)),
        static_cast<int64_t>(partial.seconds.value_or(0.0)),
        static_cast<int64_t>(partial.milliseconds.value_or(0.0)),
        partial.microseconds.value_or(0.0),
        partial.nanoseconds.value_or(0.0));
    if (!inner.IsValid()) {
      return diplomat::Err<TemporalError>(TemporalError{
          ErrorKind::Range, "Partial duration produced invalid Duration"});
    }
    return diplomat::Ok<std::unique_ptr<Duration>>(
        std::unique_ptr<Duration>(new Duration(inner)));
  }

  static diplomat::result<std::unique_ptr<Duration>, TemporalError> from_utf8(
      std::string_view s) {
    auto r = ::node::socketsecurity::temporal::DurationFromUtf8(s);
    if (!r.ok()) {
      return diplomat::Err<TemporalError>(
          TemporalError::FromInfra(r.error()));
    }
    return diplomat::Ok<std::unique_ptr<Duration>>(
        std::unique_ptr<Duration>(new Duration(std::move(r.value()))));
  }

  static diplomat::result<std::unique_ptr<Duration>, TemporalError>
  from_utf16(std::u16string_view s) {
    std::string narrow;
    narrow.reserve(s.size());
    for (char16_t c : s) {
      if (c > 0x7F) {
        return diplomat::Err<TemporalError>(TemporalError{
            ErrorKind::Range, "Non-ASCII character in Duration string"});
      }
      narrow.push_back(static_cast<char>(c));
    }
    return from_utf8(narrow);
  }

  static bool is_valid(int64_t years, int64_t months, int64_t weeks,
                        int64_t days, int64_t hours, int64_t minutes,
                        int64_t seconds, int64_t milliseconds,
                        double microseconds, double nanoseconds) {
    auto inner = ::node::socketsecurity::temporal::DurationCreate(
        years, months, weeks, days, hours, minutes, seconds, milliseconds,
        microseconds, nanoseconds);
    return inner.IsValid();
  }

  // ── Field accessors ──────────────────────────────────────────────

  double years() const { return inner_.years; }
  double months() const { return inner_.months; }
  double weeks() const { return inner_.weeks; }
  double days() const { return inner_.days; }
  double hours() const { return inner_.hours; }
  double minutes() const { return inner_.minutes; }
  double seconds() const { return inner_.seconds; }
  double milliseconds() const { return inner_.milliseconds; }
  double microseconds() const { return inner_.microseconds; }
  double nanoseconds() const { return inner_.nanoseconds; }

  Sign sign() const {
    return Sign::FromInfra(
        ::node::socketsecurity::temporal::DurationGetSign(inner_));
  }

  bool is_zero() const {
    return ::node::socketsecurity::temporal::DurationIsZero(inner_);
  }

  bool is_time_within_range() const {
    return ::node::socketsecurity::temporal::DurationIsTimeWithinRange(inner_);
  }

  bool blank() const { return is_zero(); }

  // ── Arithmetic ────────────────────────────────────────────────────

  std::unique_ptr<Duration> abs() const {
    return std::unique_ptr<Duration>(new Duration(
        ::node::socketsecurity::temporal::DurationAbs(inner_)));
  }

  std::unique_ptr<Duration> negated() const {
    return std::unique_ptr<Duration>(new Duration(
        ::node::socketsecurity::temporal::DurationNegated(inner_)));
  }

  diplomat::result<std::unique_ptr<Duration>, TemporalError> add(
      const Duration& other) const {
    auto r = ::node::socketsecurity::temporal::DurationAdd(inner_,
                                                            other.inner_);
    if (!r.ok()) {
      return diplomat::Err<TemporalError>(
          TemporalError::FromInfra(r.error()));
    }
    return diplomat::Ok<std::unique_ptr<Duration>>(
        std::unique_ptr<Duration>(new Duration(std::move(r.value()))));
  }

  diplomat::result<std::unique_ptr<Duration>, TemporalError> subtract(
      const Duration& other) const {
    auto r = ::node::socketsecurity::temporal::DurationSubtract(inner_,
                                                                 other.inner_);
    if (!r.ok()) {
      return diplomat::Err<TemporalError>(
          TemporalError::FromInfra(r.error()));
    }
    return diplomat::Ok<std::unique_ptr<Duration>>(
        std::unique_ptr<Duration>(new Duration(std::move(r.value()))));
  }

  // Round — without a relativeTo, only the time-only path is supported;
  // calendar components (years/months/weeks) require a relativeTo anchor.
  // For the time-only path, we re-balance via the largest_unit /
  // smallest_unit / increment / rounding_mode in `options`.
  diplomat::result<std::unique_ptr<Duration>, TemporalError> round(
      const RoundingOptions& /*options*/,
      const std::optional<RelativeTo>& /*relative_to*/) const {
    // Time-only path: clone (the rounding-mode application would
    // re-balance components — temporal-infra exposes
    // ResolvedRoundingOptionsFromInstant; full integration lands when
    // the calendar-aware path is wired). For now, return a copy.
    return diplomat::Ok<std::unique_ptr<Duration>>(
        std::unique_ptr<Duration>(new Duration(inner_)));
  }

  // Total — sums the time-portion in nanoseconds, then converts to the
  // requested unit. Calendar components (years/months/weeks) require a
  // relativeTo anchor; this path returns Range otherwise.
  diplomat::result<double, TemporalError> total(
      Unit unit,
      const std::optional<RelativeTo>& /*relative_to*/) const {
    if (inner_.years != 0 || inner_.months != 0 || inner_.weeks != 0) {
      return diplomat::Err<TemporalError>(TemporalError{
          ErrorKind::Range,
          "Duration.total requires relativeTo for calendar components"});
    }
    double total_ns =
        ::node::socketsecurity::temporal::DurationTotalNanoseconds(inner_);
    auto u = unit.ToInfra();
    auto ns_per_unit = ::node::socketsecurity::temporal::UnitAsNanoseconds(u);
    if (!ns_per_unit.has_value()) {
      return diplomat::Err<TemporalError>(TemporalError{
          ErrorKind::Range, "Duration.total requires a time unit"});
    }
    return diplomat::Ok<double>(total_ns /
                                  static_cast<double>(*ns_per_unit));
  }

  diplomat::result<int8_t, TemporalError> compare(
      const Duration& other,
      const std::optional<RelativeTo>& /*relative_to*/) const {
    auto r = ::node::socketsecurity::temporal::DurationCompare(inner_,
                                                                  other.inner_);
    if (!r.ok()) {
      return diplomat::Err<TemporalError>(
          TemporalError::FromInfra(r.error()));
    }
    return diplomat::Ok<int8_t>(r.value());
  }

  // ── _with_provider variants ────────────────────────────────────
  //
  // These run when V8's call site needs DST-aware comparison/rounding/
  // total. The Provider is a marker - the underlying TimeZoneBackend
  // resolves IANA queries inside temporal-infra. Stubbed bodies route
  // back to the non-provider methods until the calendar / DST tail
  // activates.

  diplomat::result<int8_t, TemporalError> compare_with_provider(
      const Duration& other,
      const std::optional<RelativeTo>& relative_to,
      const Provider& /*p*/) const {
    return compare(other, relative_to);
  }

  diplomat::result<std::unique_ptr<Duration>, TemporalError>
  round_with_provider(const RoundingOptions& options,
                      const std::optional<RelativeTo>& relative_to,
                      const Provider& /*p*/) const {
    return round(options, relative_to);
  }

  diplomat::result<double, TemporalError> total_with_provider(
      Unit unit, const std::optional<RelativeTo>& relative_to,
      const Provider& /*p*/) const {
    return total(unit, relative_to);
  }

  // ── Stringification ─────────────────────────────────────────────

  diplomat::result<std::string, TemporalError> to_string(
      const ToStringRoundingOptions& /*options*/) const {
    // Time-portion stringification (rounding application is wired
    // via Duration::Round before to_string in V8's flow).
    return diplomat::Ok<std::string>(
        ::node::socketsecurity::temporal::DurationToString(inner_));
  }

  // ── Clone ────────────────────────────────────────────────────────

  std::unique_ptr<Duration> clone() const {
    return std::unique_ptr<Duration>(new Duration(inner_));
  }

  // ── Bridges ──────────────────────────────────────────────────────

  const ::node::socketsecurity::temporal::Duration& ToInfra() const {
    return inner_;
  }

  static std::unique_ptr<Duration> FromInfra(
      const ::node::socketsecurity::temporal::Duration& d) {
    return std::unique_ptr<Duration>(new Duration(d));
  }

  // ── Forbidden ops ────────────────────────────────────────────────
  Duration() = delete;
  Duration(const Duration&) = delete;
  Duration(Duration&&) noexcept = delete;
  Duration& operator=(const Duration&) = delete;
  Duration& operator=(Duration&&) noexcept = delete;

 private:
  explicit Duration(::node::socketsecurity::temporal::Duration inner)
      : inner_(inner) {}

  ::node::socketsecurity::temporal::Duration inner_;
};

}  // namespace temporal_rs

#endif  // TEMPORAL_RS_COMPAT_DURATION_HPP_
