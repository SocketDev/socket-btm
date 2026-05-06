// 1:1 port of upstream `src/builtins/core/calendar.rs`.
//
// SCAFFOLD — only the ISO calendar path is implemented today. Non-ISO
// calendars route through ICU's C API once that binding layer lands.
// Until then, non-ISO calendars surface an "Unsupported" error so
// callers can detect the gap.

#include "socketsecurity/temporal/calendar.h"

#include <cctype>
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

int32_t SaturatingToI32(double d) noexcept {
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
    // Non-ISO calendars route through ICU; pending icu_calendar.cc.
    return TemporalError::Range(
        "Non-ISO calendar arithmetic not yet implemented");
  }
  // ISO path: AddISODate.
  const int32_t years = SaturatingToI32(duration.years);
  const int32_t months = SaturatingToI32(duration.months);
  const int32_t weeks = SaturatingToI32(duration.weeks);
  const int32_t days = SaturatingToI32(duration.days);
  IsoDate result = AddISODate(base, years, months, weeks, days);
  if (!result.IsValid()) {
    if (overflow == Overflow::kReject) {
      return TemporalError::Range("Resulting date is out of range");
    }
    return TemporalError::Range("Resulting date is out of range");
  }
  PlainDate out{};
  out.iso = result;
  return out;
}

TemporalResult<Duration> CalendarDateUntil(const Calendar& cal,
                                             const IsoDate& earlier,
                                             const IsoDate& later,
                                             Unit largest_unit) noexcept {
  if (!cal.IsIso()) {
    return TemporalError::Range(
        "Non-ISO calendar arithmetic not yet implemented");
  }
  // ISO path. Today we only support `largest_unit == Day`; year/month/
  // week breakdown lands when calendar arithmetic is wired up
  // (the spec's calendar-aware DifferenceISODate).
  if (largest_unit != Unit::kDay && largest_unit != Unit::kAuto) {
    // Fall back to days for now; upstream caller can post-process.
  }
  return DifferenceISODate(earlier, later);
}

}  // namespace temporal
}  // namespace socketsecurity
}  // namespace node
