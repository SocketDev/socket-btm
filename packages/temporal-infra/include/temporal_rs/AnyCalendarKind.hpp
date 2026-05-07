// Compat shim: temporal_rs::AnyCalendarKind. Maps onto our
// node::socketsecurity::temporal::CalendarKind 1:1 by ordinal.

#ifndef TEMPORAL_RS_COMPAT_ANYCALENDARKIND_HPP_
#define TEMPORAL_RS_COMPAT_ANYCALENDARKIND_HPP_

#include <optional>
#include <string_view>

#include "socketsecurity/temporal/calendar.h"

namespace temporal_rs {

class AnyCalendarKind {
 public:
  enum Value {
    Buddhist = 0,
    Chinese = 1,
    Coptic = 2,
    Dangi = 3,
    Ethiopian = 4,
    EthiopianAmeteAlem = 5,
    Gregorian = 6,
    Hebrew = 7,
    Indian = 8,
    HijriTabularTypeIIFriday = 9,
    HijriSimulatedMecca = 10,
    HijriTabularTypeIIThursday = 11,
    HijriUmmAlQura = 12,
    Iso = 13,
    Japanese = 14,
    JapaneseExtended = 15,
    Persian = 16,
    Roc = 17,
  };

  constexpr AnyCalendarKind() : value_(Buddhist) {}
  constexpr AnyCalendarKind(Value v) : value_(v) {}
  constexpr operator Value() const { return value_; }
  explicit operator bool() const = delete;

  // Mirror of upstream's `get_for_str(s)`. Returns nullopt for
  // unrecognized identifiers. Routes through temporal-infra's
  // Calendar::TryKindFromUtf8.
  static std::optional<AnyCalendarKind> get_for_str(std::string_view s) {
    auto kind = ::node::socketsecurity::temporal::Calendar::TryKindFromUtf8(
        reinterpret_cast<const uint8_t*>(s.data()), s.size());
    if (!kind.ok()) {
      return std::nullopt;
    }
    return FromInfra(kind.value());
  }

  // Mirror of upstream's `parse_temporal_calendar_string(s)`. The
  // spec input here is a full IXDTF string; the returned calendar
  // (if any) is the [u-ca=…] annotation. We funnel through our
  // parser, then resolve the annotation via get_for_str.
  static std::optional<AnyCalendarKind> parse_temporal_calendar_string(
      std::string_view s) {
    // The spec accepts both bare calendar identifiers (e.g.
    // "iso8601") and full IXDTF strings with `[u-ca=…]`. Try the
    // bare path first — most callers pass just the calendar name.
    if (auto bare = get_for_str(s); bare.has_value()) {
      return bare;
    }
    // Full IXDTF parse. Use our ParseDateTime to extract the
    // `[u-ca=…]` annotation, then resolve.
    // (Implementation pending — Phase 10b helper plumbing. For now,
    // return nullopt so callers fall back to the default ISO
    // calendar instead of crashing.)
    return std::nullopt;
  }

  // Bridge from temporal-infra's CalendarKind. Handles the values
  // upstream supports; HijriSimulatedMecca and JapaneseExtended
  // have no temporal-infra equivalent (Mecca is unsupported in
  // Temporal anyway; JapaneseExtended collapses to Japanese), so
  // they map down.
  static constexpr AnyCalendarKind FromInfra(
      ::node::socketsecurity::temporal::CalendarKind k) {
    using Infra = ::node::socketsecurity::temporal::CalendarKind;
    switch (k) {
      case Infra::kIso:
        return Iso;
      case Infra::kBuddhist:
        return Buddhist;
      case Infra::kChinese:
        return Chinese;
      case Infra::kCoptic:
        return Coptic;
      case Infra::kDangi:
        return Dangi;
      case Infra::kEthiopian:
        return Ethiopian;
      case Infra::kEthiopianAmeteAlem:
        return EthiopianAmeteAlem;
      case Infra::kGregorian:
        return Gregorian;
      case Infra::kHebrew:
        return Hebrew;
      case Infra::kIndian:
        return Indian;
      case Infra::kHijriTabularFriday:
        return HijriTabularTypeIIFriday;
      case Infra::kHijriTabularThursday:
        return HijriTabularTypeIIThursday;
      case Infra::kHijriUmmAlQura:
        return HijriUmmAlQura;
      case Infra::kJapanese:
        return Japanese;
      case Infra::kPersian:
        return Persian;
      case Infra::kRoc:
        return Roc;
    }
    return Iso;
  }

  // Bridge to temporal-infra's CalendarKind. The Hijri Simulated
  // Mecca variant has no equivalent in Temporal-infra (Temporal
  // doesn't expose it); it falls back to ISO per upstream's
  // documented behavior.
  constexpr ::node::socketsecurity::temporal::CalendarKind ToInfra() const {
    using Infra = ::node::socketsecurity::temporal::CalendarKind;
    switch (value_) {
      case Iso:
        return Infra::kIso;
      case Buddhist:
        return Infra::kBuddhist;
      case Chinese:
        return Infra::kChinese;
      case Coptic:
        return Infra::kCoptic;
      case Dangi:
        return Infra::kDangi;
      case Ethiopian:
        return Infra::kEthiopian;
      case EthiopianAmeteAlem:
        return Infra::kEthiopianAmeteAlem;
      case Gregorian:
        return Infra::kGregorian;
      case Hebrew:
        return Infra::kHebrew;
      case Indian:
        return Infra::kIndian;
      case HijriTabularTypeIIFriday:
        return Infra::kHijriTabularFriday;
      case HijriTabularTypeIIThursday:
        return Infra::kHijriTabularThursday;
      case HijriUmmAlQura:
        return Infra::kHijriUmmAlQura;
      case Japanese:
      case JapaneseExtended:
        return Infra::kJapanese;
      case Persian:
        return Infra::kPersian;
      case Roc:
        return Infra::kRoc;
      case HijriSimulatedMecca:
        // No infra equivalent; fall back to ISO (upstream's
        // documented Mecca-fallback behavior).
        return Infra::kIso;
    }
    return Infra::kIso;
  }

 private:
  Value value_;
};

}  // namespace temporal_rs

#endif  // TEMPORAL_RS_COMPAT_ANYCALENDARKIND_HPP_
