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
#include <mutex>
#include <string_view>

#include "socketsecurity/temporal/iso.h"
#include "socketsecurity/temporal/utils.h"

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

namespace {

// Spec: CompareISODate(d1, d2). -1 if d1<d2, 0 if equal, 1 if d1>d2.
int CompareIsoDate(const IsoDate& a, const IsoDate& b) noexcept {
  if (a.year != b.year) return a.year < b.year ? -1 : 1;
  if (a.month != b.month) return a.month < b.month ? -1 : 1;
  if (a.day != b.day) return a.day < b.day ? -1 : 1;
  return 0;
}

// Spec: ISODateSurpasses(sign, earlier, later, candidate_years,
// candidate_months, candidate_weeks, candidate_days). True iff
// earlier + candidate_duration surpasses later in the given sign
// direction (positive sign = surpasses means "goes past later";
// negative sign = surpasses means "goes before later").
//
// We only need years + months for the YearMonth/Month path.
bool IsoDateSurpasses(int sign, const IsoDate& earlier, const IsoDate& later,
                       int64_t cand_years, int64_t cand_months) noexcept {
  // Balance year+month addition into IsoDate.
  int64_t total_months = static_cast<int64_t>(earlier.month) - 1 + cand_months;
  int64_t carry_years = total_months / 12;
  total_months %= 12;
  if (total_months < 0) {
    total_months += 12;
    carry_years -= 1;
  }
  int32_t new_year = static_cast<int32_t>(
      static_cast<int64_t>(earlier.year) + cand_years + carry_years);
  uint8_t new_month = static_cast<uint8_t>(total_months + 1);
  uint8_t dim = ISODaysInMonth(new_year, new_month);
  uint8_t new_day = earlier.day < dim ? earlier.day : dim;
  IsoDate intermediate{new_year, new_month, new_day};
  int cmp = CompareIsoDate(intermediate, later);
  return sign > 0 ? cmp > 0 : cmp < 0;
}

}  // namespace

TemporalResult<Duration> CalendarDateUntil(const Calendar& cal,
                                             const IsoDate& earlier,
                                             const IsoDate& later,
                                             Unit largest_unit) noexcept {
  if (!cal.IsIso()) {
    return GetCalendarBackend().DateUntil(cal.Kind(), earlier, later,
                                            largest_unit);
  }
  // ISO Day / Auto path: pure day-count.
  if (largest_unit == Unit::kDay || largest_unit == Unit::kAuto) {
    return DifferenceISODate(earlier, later);
  }
  // ISO Year/Month/Week path: spec polyfill calendar.mjs helperISO.dateUntil
  // (loops at most twice for years, at most 12 times for months). Same
  // algorithm temporal_rs uses for iso_date_until; doesn't need a backend.
  const int sign_cmp = CompareIsoDate(earlier, later);
  if (sign_cmp == 0) {
    return Duration{};
  }
  const int sign = sign_cmp < 0 ? 1 : -1;

  int64_t years = 0;
  int64_t months = 0;
  if (largest_unit == Unit::kYear || largest_unit == Unit::kMonth) {
    int64_t candidate_years = static_cast<int64_t>(later.year) - earlier.year;
    if (candidate_years != 0) candidate_years -= sign;
    while (!IsoDateSurpasses(sign, earlier, later, candidate_years, 0)) {
      years = candidate_years;
      candidate_years += sign;
    }
    int64_t candidate_months = sign;
    while (!IsoDateSurpasses(sign, earlier, later, years, candidate_months)) {
      months = candidate_months;
      candidate_months += sign;
    }
    if (largest_unit == Unit::kMonth) {
      months += years * 12;
      years = 0;
    }
  }

  // Balance earlier + (years, months) into intermediate; remaining diff is
  // weeks + days.
  int64_t total_months = static_cast<int64_t>(earlier.month) - 1 + months;
  int64_t carry_years = total_months / 12;
  total_months %= 12;
  if (total_months < 0) {
    total_months += 12;
    carry_years -= 1;
  }
  int32_t inter_year = static_cast<int32_t>(
      static_cast<int64_t>(earlier.year) + years + carry_years);
  uint8_t inter_month = static_cast<uint8_t>(total_months + 1);
  uint8_t dim = ISODaysInMonth(inter_year, inter_month);
  uint8_t inter_day = earlier.day < dim ? earlier.day : dim;

  const int64_t inter_jdn =
      EpochDaysFromGregorianDate(inter_year, inter_month, inter_day);
  const int64_t later_jdn =
      EpochDaysFromGregorianDate(later.year, later.month, later.day);
  int64_t days = later_jdn - inter_jdn;
  int64_t weeks = 0;
  if (largest_unit == Unit::kWeek) {
    weeks = days / 7;
    days -= weeks * 7;
  }

  Duration d{};
  d.years = static_cast<double>(years);
  d.months = static_cast<double>(months);
  d.weeks = static_cast<double>(weeks);
  d.days = static_cast<double>(days);
  return d;
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

TemporalResult<uint8_t> CalendarBackend::DaysInMonth(
    CalendarKind /*kind*/, const IsoDate& /*iso*/) noexcept {
  return TemporalError::Range(
      "Non-ISO calendar daysInMonth requires a registered backend");
}

TemporalResult<uint16_t> CalendarBackend::DaysInYear(
    CalendarKind /*kind*/, const IsoDate& /*iso*/) noexcept {
  return TemporalError::Range(
      "Non-ISO calendar daysInYear requires a registered backend");
}

TemporalResult<uint8_t> CalendarBackend::MonthsInYear(
    CalendarKind /*kind*/, const IsoDate& /*iso*/) noexcept {
  return TemporalError::Range(
      "Non-ISO calendar monthsInYear requires a registered backend");
}

TemporalResult<uint8_t> CalendarBackend::DaysInWeek(
    CalendarKind /*kind*/, const IsoDate& /*iso*/) noexcept {
  return TemporalError::Range(
      "Non-ISO calendar daysInWeek requires a registered backend");
}

TemporalResult<std::string> CalendarBackend::GetMonthCodeString(
    CalendarKind /*kind*/, const IsoDate& /*iso*/) noexcept {
  return TemporalError::Range(
      "Non-ISO calendar monthCode requires a registered backend");
}

TemporalResult<std::string> CalendarBackend::Era(
    CalendarKind /*kind*/, const IsoDate& /*iso*/) noexcept {
  return TemporalError::Range(
      "Non-ISO calendar era requires a registered backend");
}

TemporalResult<std::optional<int32_t>> CalendarBackend::EraYear(
    CalendarKind /*kind*/, const IsoDate& /*iso*/) noexcept {
  return TemporalError::Range(
      "Non-ISO calendar eraYear requires a registered backend");
}

TemporalResult<bool> CalendarBackend::InLeapYear(
    CalendarKind /*kind*/, const IsoDate& /*iso*/) noexcept {
  return TemporalError::Range(
      "Non-ISO calendar inLeapYear requires a registered backend");
}

TemporalResult<uint8_t> CalendarBackend::ResolveMonthCode(
    CalendarKind /*kind*/, int32_t /*year*/,
    const MonthCode& /*code*/) noexcept {
  return TemporalError::Range(
      "Non-ISO calendar month-code resolution requires a registered backend");
}

// ── Front-door dispatch helpers ──────────────────────────────────────
//
// Each accessor short-circuits for ISO (the inline math is trivial)
// and falls through to the registered backend for non-ISO calendars.
// Non-ISO without a registered backend returns the spec-acceptable
// default (rather than propagating an error through accessors that
// V8 expects to be infallible).

uint8_t CalendarDaysInMonth(const Calendar& cal,
                             const IsoDate& iso) noexcept {
  if (cal.IsIso()) {
    return ISODaysInMonth(iso.year, iso.month);
  }
  auto r = GetCalendarBackend().DaysInMonth(cal.Kind(), iso);
  return r.ok() ? r.value() : ISODaysInMonth(iso.year, iso.month);
}

uint16_t CalendarDaysInYear(const Calendar& cal,
                             const IsoDate& iso) noexcept {
  if (cal.IsIso()) {
    return IsLeapYear(iso.year) ? 366 : 365;
  }
  auto r = GetCalendarBackend().DaysInYear(cal.Kind(), iso);
  return r.ok() ? r.value() : (IsLeapYear(iso.year) ? 366 : 365);
}

uint8_t CalendarMonthsInYear(const Calendar& cal,
                              const IsoDate& iso) noexcept {
  if (cal.IsIso()) {
    return 12;
  }
  auto r = GetCalendarBackend().MonthsInYear(cal.Kind(), iso);
  return r.ok() ? r.value() : 12;
}

uint8_t CalendarDaysInWeek(const Calendar& cal,
                            const IsoDate& iso) noexcept {
  if (cal.IsIso()) {
    return 7;
  }
  auto r = GetCalendarBackend().DaysInWeek(cal.Kind(), iso);
  return r.ok() ? r.value() : 7;
}

std::string CalendarMonthCode(const Calendar& cal,
                               const IsoDate& iso) noexcept {
  if (cal.IsIso()) {
    std::string out = "M";
    if (iso.month < 10) out.push_back('0');
    out += std::to_string(iso.month);
    return out;
  }
  auto r = GetCalendarBackend().GetMonthCodeString(cal.Kind(), iso);
  if (r.ok()) return r.value();
  std::string out = "M";
  if (iso.month < 10) out.push_back('0');
  out += std::to_string(iso.month);
  return out;
}

std::string CalendarEra(const Calendar& cal, const IsoDate& iso) noexcept {
  if (cal.IsIso()) {
    return "";  // ISO has no era surface.
  }
  auto r = GetCalendarBackend().Era(cal.Kind(), iso);
  return r.ok() ? r.value() : "";
}

std::optional<int32_t> CalendarEraYear(const Calendar& cal,
                                         const IsoDate& iso) noexcept {
  if (cal.IsIso()) {
    return std::nullopt;
  }
  auto r = GetCalendarBackend().EraYear(cal.Kind(), iso);
  return r.ok() ? r.value() : std::optional<int32_t>{};
}

bool CalendarInLeapYear(const Calendar& cal, const IsoDate& iso) noexcept {
  if (cal.IsIso()) {
    return IsLeapYear(iso.year);
  }
  auto r = GetCalendarBackend().InLeapYear(cal.Kind(), iso);
  return r.ok() ? r.value() : IsLeapYear(iso.year);
}

TemporalResult<uint8_t> CalendarResolveMonthCode(
    const Calendar& cal, int32_t year, const MonthCode& code) noexcept {
  // Spec: bytes[0] must be 'M', bytes[1..2] must be ASCII digits.
  if (code.bytes[0] != 'M') {
    return TemporalError::Range(
        "MonthCode must start with 'M' followed by two digits");
  }
  const uint8_t tens = code.bytes[1];
  const uint8_t ones = code.bytes[2];
  if (tens < '0' || tens > '9' || ones < '0' || ones > '9') {
    return TemporalError::Range(
        "MonthCode tens/ones bytes must be ASCII digits");
  }
  const uint8_t ordinal = static_cast<uint8_t>((tens - '0') * 10 + (ones - '0'));
  if (ordinal < 1 || ordinal > 13) {
    return TemporalError::Range("MonthCode ordinal out of 1..13 range");
  }
  const bool leap = (code.bytes[3] == 'L');
  if (cal.IsIso()) {
    if (leap || ordinal > 12) {
      return TemporalError::Range(
          "ISO calendar does not support leap months");
    }
    return ordinal;
  }
  // Non-ISO: delegate to the registered backend. ICU resolves the
  // year-dependent mapping (Hebrew Adar I/II, Chinese leap months).
  return GetCalendarBackend().ResolveMonthCode(cal.Kind(), year, code);
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
  // Mirror of time_zone.cc: lazy-install the ICU-backed backend on
  // first call. The trampoline lives in icu_cal_backend.cc with a
  // V8_INTL_SUPPORT-conditional body (no-op in non-intl builds).
  extern void InstallIcuCalendarBackendIfAvailable() noexcept;
  static std::once_flag s_installed_once;
  std::call_once(s_installed_once,
                  []() { InstallIcuCalendarBackendIfAvailable(); });
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
