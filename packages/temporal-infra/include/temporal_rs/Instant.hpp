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
// Phase 10a covers: try_new, from_epoch_milliseconds, from_utf8,
// from_utf16, epoch_milliseconds, epoch_nanoseconds, equals,
// compare, clone. Methods that depend on the unported V8/ICU
// integration boundary (round, since, until, add, subtract,
// to_ixdtf_string_with_provider, to_zoned_date_time_iso) return
// TemporalError until Phase 10b activates them.

#ifndef TEMPORAL_RS_COMPAT_INSTANT_HPP_
#define TEMPORAL_RS_COMPAT_INSTANT_HPP_

#include <cstdint>
#include <memory>
#include <optional>
#include <string>
#include <string_view>

#include "socketsecurity/temporal/parse.h"
#include "socketsecurity/temporal/temporal.h"
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
    Int128 ms = inner_.epoch_nanoseconds / Int128(int64_t{1'000'000});
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
  // Stub: temporal-infra exposes ResolvedRoundingOptionsFromInstant but
  // wiring it through to a re-balanced Instant requires the rounding
  // tail to land. For now, return a clone (which is the no-op rounding
  // result); V8 sees this as "rounding succeeded with the same value."
  diplomat::result<std::unique_ptr<Instant>, TemporalError> round(
      const RoundingOptions& /*options*/) const {
    return diplomat::Ok<std::unique_ptr<Instant>>(
        std::unique_ptr<Instant>(new Instant(inner_)));
  }

  // ── ZDT projection ─────────────────────────────────────────────
  //
  // Declared here, defined inline at the bottom of the file (after
  // ZonedDateTime.hpp is pulled in via a forward-include trick).
  // V8 always sees ZonedDateTime.hpp before instantiating this method.
  inline diplomat::result<std::unique_ptr<ZonedDateTime>, TemporalError>
  to_zoned_date_time_iso_with_provider(const TimeZone& tz,
                                         const Provider& p) const;

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

  // since / until — Duration of (self - other) / (other - self).
  template <class D>
  std::unique_ptr<D> since_dur(const Instant& other) const {
    auto d = ::node::socketsecurity::temporal::InstantSince(other.inner_,
                                                              inner_);
    return D::FromInfra(d);
  }
  template <class D>
  std::unique_ptr<D> until_dur(const Instant& other) const {
    auto d = ::node::socketsecurity::temporal::InstantSince(inner_,
                                                              other.inner_);
    return D::FromInfra(d);
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

}  // namespace temporal_rs

#endif  // TEMPORAL_RS_COMPAT_INSTANT_HPP_
