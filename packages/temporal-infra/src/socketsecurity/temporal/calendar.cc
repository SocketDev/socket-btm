// 1:1 port of upstream `src/builtins/core/calendar.rs`.
//
// ISO is handled inline; non-ISO calendar arithmetic delegates to
// the registered CalendarBackend. The default backend rejects every
// non-ISO input; V8's js-temporal layer installs an ICU-backed
// override at boot.

#include "socketsecurity/temporal/calendar.h"

#include <atomic>
#include <cctype>
#include <cmath>
#include <string_view>

#include "socketsecurity/temporal/iso.h"

namespace node {
namespace socketsecurity {
namespace temporal {

namespace {

// Lowercase a character for case-insensitive calendar identifier match.
char ToAsciiLower(char c) noexcept {
  return (c >= 'A' && c <= 'Z') ? static_cast<char>(c + ('a' - 'A')) : c;
}

bool EqualsLowercase(std::string_view input,
                     std::string_view canonical) noexcept {
  if (input.size() != canonical.size()) {
    return false;
  }
  for (size_t i = 0; i < input.size(); ++i) {
    if (ToAsciiLower(input[i]) != canonical[i]) {
      return false;
    }
  }
  return true;
}

}  // namespace

TemporalResult<CalendarKind> Calendar::TryKindFromUtf8(
    const uint8_t* data, size_t length) noexcept {
  std::string_view input(reinterpret_cast<const char*>(data), length);
  // Aliases per ICU CLDR: "iso8601" canonical; "gregory" → "gregorian";
  // "islamic" → HijriTabularFriday (matches upstream); etc.
  if (EqualsLowercase(input, "iso8601") || EqualsLowercase(input, "iso")) {
    return CalendarKind::kIso;
  }
  if (EqualsLowercase(input, "buddhist")) return CalendarKind::kBuddhist;
  if (EqualsLowercase(input, "chinese")) return CalendarKind::kChinese;
  if (EqualsLowercase(input, "coptic")) return CalendarKind::kCoptic;
  if (EqualsLowercase(input, "dangi")) return CalendarKind::kDangi;
  if (EqualsLowercase(input, "ethiopian")) return CalendarKind::kEthiopian;
  if (EqualsLowercase(input, "ethioaa") ||
      EqualsLowercase(input, "ethiopic-amete-alem")) {
    return CalendarKind::kEthiopianAmeteAlem;
  }
  if (EqualsLowercase(input, "gregorian") ||
      EqualsLowercase(input, "gregory")) {
    return CalendarKind::kGregorian;
  }
  if (EqualsLowercase(input, "hebrew")) return CalendarKind::kHebrew;
  if (EqualsLowercase(input, "indian")) return CalendarKind::kIndian;
  if (EqualsLowercase(input, "islamic") ||
      EqualsLowercase(input, "islamic-civil") ||
      EqualsLowercase(input, "islamic-tbla")) {
    return CalendarKind::kHijriTabularFriday;
  }
  if (EqualsLowercase(input, "islamicc")) {
    return CalendarKind::kHijriTabularThursday;
  }
  if (EqualsLowercase(input, "islamic-umalqura")) {
    return CalendarKind::kHijriUmmAlQura;
  }
  if (EqualsLowercase(input, "japanese")) return CalendarKind::kJapanese;
  if (EqualsLowercase(input, "persian")) return CalendarKind::kPersian;
  if (EqualsLowercase(input, "roc")) return CalendarKind::kRoc;
  return TemporalError::Range("unknown calendar");
}

TemporalResult<Calendar> Calendar::TryFromUtf8(const uint8_t* data,
                                                  size_t length) noexcept {
  auto kind = TryKindFromUtf8(data, length);
  if (!kind.ok()) {
    return kind.error();
  }
  return Calendar(kind.value());
}

std::string_view Calendar::Identifier() const noexcept {
  switch (kind_) {
    case CalendarKind::kIso:
      return "iso8601";
    case CalendarKind::kBuddhist:
      return "buddhist";
    case CalendarKind::kChinese:
      return "chinese";
    case CalendarKind::kCoptic:
      return "coptic";
    case CalendarKind::kDangi:
      return "dangi";
    case CalendarKind::kEthiopian:
      return "ethiopian";
    case CalendarKind::kEthiopianAmeteAlem:
      return "ethioaa";
    case CalendarKind::kGregorian:
      return "gregory";
    case CalendarKind::kHebrew:
      return "hebrew";
    case CalendarKind::kIndian:
      return "indian";
    case CalendarKind::kHijriTabularFriday:
      return "islamic-tbla";
    case CalendarKind::kHijriTabularThursday:
      return "islamicc";
    case CalendarKind::kHijriUmmAlQura:
      return "islamic-umalqura";
    case CalendarKind::kJapanese:
      return "japanese";
    case CalendarKind::kPersian:
      return "persian";
    case CalendarKind::kRoc:
      return "roc";
  }
  return "iso8601";
}

namespace {

// NaN guard prevents UB on `static_cast<int32_t>(NaN)`; see
// plain_date.cc for the rationale.
int32_t SaturatingToI32(double d) noexcept {
  if (std::isnan(d)) return 0;
  if (d > 2147483647.0) return 2147483647;
  if (d < -2147483648.0) return -2147483648;
  return static_cast<int32_t>(d);
}

}  // namespace

TemporalResult<PlainDate> CalendarDateAdd(const Calendar& cal,
                                            const IsoDate& base,
                                            const Duration& duration,
                                            Overflow overflow) noexcept {
  if (!cal.IsIso()) {
    auto result = GetCalendarBackend().DateAdd(cal.Kind(), base, duration,
                                                 overflow);
    if (!result.ok()) {
      return result.error();
    }
    PlainDate out{};
    out.iso = result.value();
    return out;
  }
  // ISO path: AddISODate.
  const int32_t years = SaturatingToI32(duration.years);
  const int32_t months = SaturatingToI32(duration.months);
  const int32_t weeks = SaturatingToI32(duration.weeks);
  const int32_t days = SaturatingToI32(duration.days);
  IsoDate result = AddISODate(base, years, months, weeks, days);
  if (!result.IsValid()) {
    return TemporalError::Range("Resulting date is out of range");
  }
  (void)overflow;  // ISO regulator already applies the overflow rule.
  PlainDate out{};
  out.iso = result;
  return out;
}

TemporalResult<Duration> CalendarDateUntil(const Calendar& cal,
                                             const IsoDate& earlier,
                                             const IsoDate& later,
                                             Unit largest_unit) noexcept {
  if (!cal.IsIso()) {
    return GetCalendarBackend().DateUntil(cal.Kind(), earlier, later,
                                            largest_unit);
  }
  // ISO path. `largest_unit == Day` (or Auto) emits days only; year/
  // month/week breakdowns require the calendar's day-of-month rules
  // and route through the same backend.
  if (largest_unit == Unit::kDay || largest_unit == Unit::kAuto) {
    return DifferenceISODate(earlier, later);
  }
  return GetCalendarBackend().DateUntil(CalendarKind::kIso, earlier, later,
                                          largest_unit);
}

// ── CalendarBackend ───────────────────────────────────────────────────

TemporalResult<IsoDate> CalendarBackend::DateAdd(
    CalendarKind /*kind*/, const IsoDate& /*base*/,
    const Duration& /*duration*/, Overflow /*overflow*/) noexcept {
  return TemporalError::Range(
      "Non-ISO calendar arithmetic requires a registered backend "
      "(V8's js-temporal layer installs one at boot)");
}

TemporalResult<Duration> CalendarBackend::DateUntil(
    CalendarKind /*kind*/, const IsoDate& /*earlier*/,
    const IsoDate& /*later*/, Unit /*largest_unit*/) noexcept {
  return TemporalError::Range(
      "Non-ISO calendar diff requires a registered backend "
      "(V8's js-temporal layer installs one at boot)");
}

namespace {
CalendarBackend& DefaultCalendarBackend() noexcept {
  static CalendarBackend instance;
  return instance;
}
std::atomic<CalendarBackend*>& ActiveCalendarBackendSlot() noexcept {
  static std::atomic<CalendarBackend*> slot{&DefaultCalendarBackend()};
  return slot;
}
}  // namespace

CalendarBackend& GetCalendarBackend() noexcept {
  return *ActiveCalendarBackendSlot().load(std::memory_order_acquire);
}

void SetCalendarBackend(CalendarBackend* backend) noexcept {
  ActiveCalendarBackendSlot().store(
      backend ? backend : &DefaultCalendarBackend(),
      std::memory_order_release);
}

}  // namespace temporal
}  // namespace socketsecurity
}  // namespace node
