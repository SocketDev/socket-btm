// ICU-backed CalendarBackend implementation. Mirrors the structure of
// icu_tz_backend.cc — V8_INTL_SUPPORT enables ICU dispatch, otherwise
// every virtual returns a sharp "ICU calendar backend requires
// V8_INTL_SUPPORT" error.

#include "socketsecurity/temporal/icu_cal_backend.h"

#include "socketsecurity/temporal/utils.h"

#ifdef V8_INTL_SUPPORT
#include "unicode/calendar.h"
#include "unicode/locid.h"
#include "unicode/ucal.h"
#include "unicode/utypes.h"
#endif

namespace node {
namespace socketsecurity {
namespace temporal {

#ifdef V8_INTL_SUPPORT

namespace {

// Map our CalendarKind to ICU's locale-keyword string. Returns
// nullptr for kIso (which never routes through this backend — the
// front-door dispatch helpers short-circuit ISO inline).
const char* CalendarKindToLocaleKeyword(CalendarKind kind) noexcept {
  switch (kind) {
    case CalendarKind::kIso:                  return nullptr;
    case CalendarKind::kBuddhist:             return "@calendar=buddhist";
    case CalendarKind::kChinese:              return "@calendar=chinese";
    case CalendarKind::kCoptic:               return "@calendar=coptic";
    case CalendarKind::kDangi:                return "@calendar=dangi";
    case CalendarKind::kEthiopian:            return "@calendar=ethiopic";
    case CalendarKind::kEthiopianAmeteAlem:
      return "@calendar=ethiopic-amete-alem";
    case CalendarKind::kGregorian:            return "@calendar=gregorian";
    case CalendarKind::kHebrew:               return "@calendar=hebrew";
    case CalendarKind::kIndian:               return "@calendar=indian";
    case CalendarKind::kHijriTabularFriday:   return "@calendar=islamic-civil";
    case CalendarKind::kHijriTabularThursday: return "@calendar=islamic-tbla";
    case CalendarKind::kHijriUmmAlQura:       return "@calendar=islamic-umalqura";
    case CalendarKind::kJapanese:             return "@calendar=japanese";
    case CalendarKind::kPersian:              return "@calendar=persian";
    case CalendarKind::kRoc:                  return "@calendar=roc";
  }
  return nullptr;
}

// Open an icu::Calendar for the given kind, positioned at the given
// IsoDate. Returns nullptr on any error (unknown calendar, ICU
// internal failure). Caller owns the returned pointer.
std::unique_ptr<icu::Calendar> OpenIcuCal(CalendarKind kind,
                                            const IsoDate& iso) {
  const char* keyword = CalendarKindToLocaleKeyword(kind);
  if (keyword == nullptr) return nullptr;
  UErrorCode status = U_ZERO_ERROR;
  icu::Locale locale(keyword);
  std::unique_ptr<icu::Calendar> cal(
      icu::Calendar::createInstance(locale, status));
  if (U_FAILURE(status) || cal == nullptr) return nullptr;
  // Position the calendar at the ISO date by feeding it the UDate
  // (epoch ms). ICU re-projects into its native calendar's fields.
  const int64_t epoch_days = EpochDaysFromGregorianDate(
      iso.year, iso.month, iso.day);
  const int64_t epoch_ms = epoch_days * kMsPerDay;
  cal->setTime(static_cast<UDate>(epoch_ms), status);
  if (U_FAILURE(status)) return nullptr;
  return cal;
}

// Helper for "read an ICU calendar field as int32".
TemporalResult<int32_t> GetField(CalendarKind kind, const IsoDate& iso,
                                   UCalendarDateFields field) {
  auto cal = OpenIcuCal(kind, iso);
  if (cal == nullptr) {
    return TemporalError::Range("Unknown calendar identifier");
  }
  UErrorCode status = U_ZERO_ERROR;
  const int32_t value = cal->get(field, status);
  if (U_FAILURE(status)) {
    return TemporalError::Range("ICU Calendar::get failed");
  }
  return value;
}

}  // namespace

TemporalResult<IsoDate> IcuCalendarBackend::DateAdd(
    CalendarKind kind, const IsoDate& base, const Duration& duration,
    Overflow /*overflow*/) noexcept {
  auto cal = OpenIcuCal(kind, base);
  if (cal == nullptr) {
    return TemporalError::Range("Unknown calendar identifier");
  }
  UErrorCode status = U_ZERO_ERROR;
  // ICU's `add` advances the calendar's current time by the given
  // amount of the given field. Spec order: years → months → weeks →
  // days, each applied separately so the rollover is calendar-aware
  // (Hebrew leap-month behavior, etc.).
  cal->add(UCAL_YEAR, static_cast<int32_t>(duration.years), status);
  if (U_FAILURE(status)) {
    return TemporalError::Range("ICU Calendar::add year failed");
  }
  cal->add(UCAL_MONTH, static_cast<int32_t>(duration.months), status);
  if (U_FAILURE(status)) {
    return TemporalError::Range("ICU Calendar::add month failed");
  }
  cal->add(UCAL_WEEK_OF_YEAR, static_cast<int32_t>(duration.weeks), status);
  if (U_FAILURE(status)) {
    return TemporalError::Range("ICU Calendar::add week failed");
  }
  cal->add(UCAL_DATE, static_cast<int32_t>(duration.days), status);
  if (U_FAILURE(status)) {
    return TemporalError::Range("ICU Calendar::add day failed");
  }
  // Read back the resulting ISO date via the UDate accessor.
  const UDate result_ms = cal->getTime(status);
  if (U_FAILURE(status)) {
    return TemporalError::Range("ICU Calendar::getTime failed");
  }
  const int64_t epoch_ms = static_cast<int64_t>(result_ms);
  // Floor-divide by ms-per-day so negative epochs (pre-1970) yield
  // the calendar-correct day boundary.
  int64_t epoch_days = epoch_ms / kMsPerDay;
  if ((epoch_ms % kMsPerDay) != 0 && epoch_ms < 0) {
    epoch_days -= 1;
  }
  IsoDate out{};
  YmdFromEpochDays(epoch_days, &out.year, &out.month, &out.day);
  if (!out.IsValid()) {
    return TemporalError::Range("Resulting date out of valid range");
  }
  return out;
}

TemporalResult<Duration> IcuCalendarBackend::DateUntil(
    CalendarKind kind, const IsoDate& earlier, const IsoDate& later,
    Unit largest_unit) noexcept {
  // ICU's Calendar has fieldDifference for this, but its API mutates
  // the calendar in place. Open two calendars (or read fields off
  // one), compute the diff.
  auto cal = OpenIcuCal(kind, earlier);
  if (cal == nullptr) {
    return TemporalError::Range("Unknown calendar identifier");
  }
  const int64_t later_epoch_days = EpochDaysFromGregorianDate(
      later.year, later.month, later.day);
  const UDate later_ms = static_cast<UDate>(later_epoch_days * kMsPerDay);
  UErrorCode status = U_ZERO_ERROR;
  Duration out{};
  switch (largest_unit) {
    case Unit::kYear:
      out.years = cal->fieldDifference(later_ms, UCAL_YEAR, status);
      // Fall through to compute remaining months / weeks / days
      // against the still-mutating `cal` (fieldDifference advances
      // the internal time toward target).
      [[fallthrough]];
    case Unit::kMonth:
      out.months = cal->fieldDifference(later_ms, UCAL_MONTH, status);
      [[fallthrough]];
    case Unit::kWeek:
      out.weeks = cal->fieldDifference(later_ms, UCAL_WEEK_OF_YEAR, status);
      [[fallthrough]];
    case Unit::kDay:
    case Unit::kAuto:
    default:
      out.days = cal->fieldDifference(later_ms, UCAL_DATE, status);
      break;
  }
  if (U_FAILURE(status)) {
    return TemporalError::Range("ICU Calendar::fieldDifference failed");
  }
  return out;
}

TemporalResult<uint8_t> IcuCalendarBackend::DaysInMonth(
    CalendarKind kind, const IsoDate& iso) noexcept {
  auto cal = OpenIcuCal(kind, iso);
  if (cal == nullptr) {
    return TemporalError::Range("Unknown calendar identifier");
  }
  UErrorCode status = U_ZERO_ERROR;
  const int32_t value =
      cal->getActualMaximum(UCAL_DAY_OF_MONTH, status);
  if (U_FAILURE(status) || value < 0 || value > 31) {
    return TemporalError::Range("ICU getActualMaximum(day_of_month) failed");
  }
  return static_cast<uint8_t>(value);
}

TemporalResult<uint16_t> IcuCalendarBackend::DaysInYear(
    CalendarKind kind, const IsoDate& iso) noexcept {
  auto cal = OpenIcuCal(kind, iso);
  if (cal == nullptr) {
    return TemporalError::Range("Unknown calendar identifier");
  }
  UErrorCode status = U_ZERO_ERROR;
  const int32_t value =
      cal->getActualMaximum(UCAL_DAY_OF_YEAR, status);
  if (U_FAILURE(status) || value < 0 || value > 400) {
    return TemporalError::Range("ICU getActualMaximum(day_of_year) failed");
  }
  return static_cast<uint16_t>(value);
}

TemporalResult<uint8_t> IcuCalendarBackend::MonthsInYear(
    CalendarKind kind, const IsoDate& iso) noexcept {
  auto cal = OpenIcuCal(kind, iso);
  if (cal == nullptr) {
    return TemporalError::Range("Unknown calendar identifier");
  }
  UErrorCode status = U_ZERO_ERROR;
  // ICU's MONTH field is 0-indexed (UCAL_JANUARY = 0); max + 1 = count.
  const int32_t max_month =
      cal->getActualMaximum(UCAL_MONTH, status);
  if (U_FAILURE(status) || max_month < 0 || max_month > 12) {
    return TemporalError::Range("ICU getActualMaximum(month) failed");
  }
  return static_cast<uint8_t>(max_month + 1);
}

TemporalResult<uint8_t> IcuCalendarBackend::DaysInWeek(
    CalendarKind kind, const IsoDate& /*iso*/) noexcept {
  // Per Temporal spec, daysInWeek is always 7 for every supported
  // calendar (no calendar in the spec set has variable-length weeks).
  // Spec ref: https://tc39.es/proposal-temporal/#sec-temporal-calendarayidaysinweek
  (void)kind;
  return uint8_t{7};
}

TemporalResult<std::string> IcuCalendarBackend::MonthCode(
    CalendarKind kind, const IsoDate& iso) noexcept {
  auto cal = OpenIcuCal(kind, iso);
  if (cal == nullptr) {
    return TemporalError::Range("Unknown calendar identifier");
  }
  UErrorCode status = U_ZERO_ERROR;
  const int32_t month_zero = cal->get(UCAL_MONTH, status);
  if (U_FAILURE(status) || month_zero < 0 || month_zero > 12) {
    return TemporalError::Range("ICU Calendar::get(MONTH) failed");
  }
  // Temporal spec MonthCode is "M01".."M13" for normal months and
  // "M01L".."M12L" for leap months. ICU's IS_LEAP_MONTH field (when
  // available) tells us whether to append "L". For calendars where
  // the field is absent (Gregorian-derived, Hebrew sometimes), the
  // suffix is omitted.
  const int32_t month_one = month_zero + 1;
  bool is_leap = false;
  UErrorCode leap_status = U_ZERO_ERROR;
  const int32_t leap_flag = cal->get(UCAL_IS_LEAP_MONTH, leap_status);
  if (U_SUCCESS(leap_status)) {
    is_leap = (leap_flag != 0);
  }
  std::string out = "M";
  if (month_one < 10) out.push_back('0');
  out += std::to_string(month_one);
  if (is_leap) out.push_back('L');
  return out;
}

TemporalResult<std::string> IcuCalendarBackend::Era(
    CalendarKind kind, const IsoDate& iso) noexcept {
  auto era = GetField(kind, iso, UCAL_ERA);
  if (!era.ok()) return era.error();
  // ICU returns numeric era indices. Map to spec-stable era codes
  // per the Temporal spec's "Calendar Era Codes" table. Coverage
  // here is the practical subset; calendars without distinct eras
  // (Chinese, Hebrew, Islamic family) return empty string.
  switch (kind) {
    case CalendarKind::kGregorian:
    case CalendarKind::kIso:
    case CalendarKind::kBuddhist:
      // Gregorian-style: 0 = BC/BCE, 1 = AD/CE.
      return std::string(era.value() == 0 ? "bce" : "ce");
    case CalendarKind::kJapanese:
      // Japanese: numeric index into era list. Spec uses lower-cased
      // era names ("meiji", "taisho", "showa", "heisei", "reiwa"
      // and earlier). Without ICU's era-name lookup at compile
      // time, we return the era index as a string for now; consumers
      // who need the name can resolve via Intl.
      return std::string("japanese-" + std::to_string(era.value()));
    case CalendarKind::kRoc:
      return std::string(era.value() == 0 ? "before-roc" : "roc");
    case CalendarKind::kCoptic:
    case CalendarKind::kEthiopian:
    case CalendarKind::kEthiopianAmeteAlem:
      return std::string(era.value() == 0 ? "incarnation" : "before-incarnation");
    default:
      return std::string();
  }
}

TemporalResult<std::optional<int32_t>> IcuCalendarBackend::EraYear(
    CalendarKind kind, const IsoDate& iso) noexcept {
  switch (kind) {
    // Calendars without distinct eras have no eraYear surface.
    case CalendarKind::kChinese:
    case CalendarKind::kDangi:
    case CalendarKind::kHebrew:
    case CalendarKind::kIndian:
    case CalendarKind::kHijriTabularFriday:
    case CalendarKind::kHijriTabularThursday:
    case CalendarKind::kHijriUmmAlQura:
    case CalendarKind::kPersian:
    case CalendarKind::kIso:
      return std::optional<int32_t>{};
    default:
      break;
  }
  auto y = GetField(kind, iso, UCAL_YEAR);
  if (!y.ok()) return y.error();
  return std::optional<int32_t>{y.value()};
}

TemporalResult<bool> IcuCalendarBackend::InLeapYear(
    CalendarKind kind, const IsoDate& iso) noexcept {
  // For calendars where ICU exposes a leap-year predicate via
  // getActualMaximum(MONTH) >= 12 vs == 12, compare months_in_year.
  auto mc = MonthsInYear(kind, iso);
  if (!mc.ok()) return mc.error();
  // Hebrew calendar: 13 months = leap year; 12 months = normal.
  // Gregorian-derived: months always 12, but days_in_year shifts.
  if (mc.value() > 12) return true;
  auto dy = DaysInYear(kind, iso);
  if (!dy.ok()) return dy.error();
  // Gregorian leap = 366 days; Coptic/Ethiopian leap = 366; Hebrew
  // leap handled above; Chinese leap also via month count.
  return dy.value() > 365;
}

// 1:1 from upstream `Calendar::resolve_month_code`. Hebrew and Chinese
// (Dangi) calendars are the only TC39-Temporal calendars with leap
// months. For Hebrew, the leap month is Adar I in years 3, 6, 8, 11,
// 14, 17, 19 of a 19-year Metonic cycle; M05L (Adar I) precedes M06
// (Adar II == regular Adar) in those years. ICU's UCAL_IS_LEAP_MONTH
// extension lets us detect leap-position months directly.
TemporalResult<uint8_t> IcuCalendarBackend::ResolveMonthCode(
    CalendarKind kind, int32_t year, const MonthCode& code) noexcept {
  // Validate ASCII shape (caller already checked, but be defensive).
  if (code.bytes[0] != 'M') {
    return TemporalError::Range("MonthCode must start with 'M'");
  }
  const uint8_t tens = code.bytes[1];
  const uint8_t ones = code.bytes[2];
  if (tens < '0' || tens > '9' || ones < '0' || ones > '9') {
    return TemporalError::Range("MonthCode digits invalid");
  }
  const uint8_t target_month =
      static_cast<uint8_t>((tens - '0') * 10 + (ones - '0'));
  const bool target_leap = (code.bytes[3] == 'L');

  // Fast path: calendars without leap months. For these, M01..M12
  // maps 1:1 and leap codes are invalid.
  switch (kind) {
    case CalendarKind::kIso:
    case CalendarKind::kBuddhist:
    case CalendarKind::kCoptic:
    case CalendarKind::kEthiopian:
    case CalendarKind::kEthiopianAmeteAlem:
    case CalendarKind::kGregorian:
    case CalendarKind::kIndian:
    case CalendarKind::kHijriTabularFriday:
    case CalendarKind::kHijriTabularThursday:
    case CalendarKind::kHijriUmmAlQura:
    case CalendarKind::kJapanese:
    case CalendarKind::kPersian:
    case CalendarKind::kRoc: {
      if (target_leap) {
        return TemporalError::Range(
            "Calendar does not support leap months");
      }
      // Coptic/Ethiopian have 13 months in normal years; others have
      // 12. The 13th is non-leap (the 5/6-day "epagomenal" month).
      // M13 is valid for them and 13.
      const uint8_t max_months =
          (kind == CalendarKind::kCoptic ||
           kind == CalendarKind::kEthiopian ||
           kind == CalendarKind::kEthiopianAmeteAlem)
              ? 13
              : 12;
      if (target_month < 1 || target_month > max_months) {
        return TemporalError::Range("MonthCode ordinal out of range");
      }
      return target_month;
    }
    case CalendarKind::kHebrew:
    case CalendarKind::kChinese:
    case CalendarKind::kDangi:
      // Fall through to ICU-aware path below.
      break;
  }

  // Leap-aware path. Open ICU on Jan 1 of the requested ISO year so
  // we can walk months counting leap positions. The actual ISO date
  // doesn't matter — we just need a calendar pinned to a year in
  // which the requested monthCode resolves.
  IsoDate probe{year, 1, 1};
  auto cal = OpenIcuCal(kind, probe);
  if (cal == nullptr) {
    return TemporalError::Range("Unknown calendar identifier");
  }
  UErrorCode status = U_ZERO_ERROR;
  const int32_t max_month = cal->getActualMaximum(UCAL_MONTH, status);
  if (U_FAILURE(status)) {
    return TemporalError::Range("ICU Calendar::getActualMaximum failed");
  }
  // Walk months 0..max_month inclusive (ICU's UCAL_MONTH is
  // zero-indexed). For each, check the UCAL_IS_LEAP_MONTH extension.
  // Hebrew sequence: M01..M04 = Tishri..Tevet, M05 = Shevat, M05L =
  // Adar I (leap years only), M06 = Adar (or Adar II in leap years),
  // M07..M12 = Nisan..Elul. ICU walks the months in chronological
  // order; M05L is the position where IS_LEAP_MONTH is set.
  uint8_t ordinal = 0;
  for (int32_t m = 0; m <= max_month; ++m) {
    cal->set(UCAL_MONTH, m);
    status = U_ZERO_ERROR;
    const int32_t is_leap = cal->get(UCAL_IS_LEAP_MONTH, status);
    if (U_FAILURE(status)) {
      // Calendars that don't implement UCAL_IS_LEAP_MONTH return error;
      // treat all months as non-leap.
      status = U_ZERO_ERROR;
    }
    const bool month_is_leap = (is_leap == 1);
    if (!month_is_leap) {
      ordinal += 1;
    }
    if (target_leap && month_is_leap) {
      // Hebrew: leap-month sits between ordinals target_month and
      // target_month+1 (Adar I before Adar II). Match when the
      // running ordinal equals target_month.
      if (ordinal == target_month) {
        return static_cast<uint8_t>(m + 1);  // 1-indexed return
      }
    } else if (!target_leap && !month_is_leap) {
      if (ordinal == target_month) {
        return static_cast<uint8_t>(m + 1);
      }
    }
  }
  return TemporalError::Range(
      "MonthCode does not resolve to a month in this calendar/year");
}

void InstallIcuCalendarBackend() noexcept {
  static IcuCalendarBackend instance;
  SetCalendarBackend(&instance);
}

void InstallIcuCalendarBackendIfAvailable() noexcept {
  InstallIcuCalendarBackend();
}

#else  // !V8_INTL_SUPPORT

TemporalResult<IsoDate> IcuCalendarBackend::DateAdd(
    CalendarKind /*kind*/, const IsoDate& /*base*/,
    const Duration& /*duration*/, Overflow /*overflow*/) noexcept {
  return TemporalError::Range(
      "ICU calendar backend requires V8_INTL_SUPPORT to be enabled");
}
TemporalResult<Duration> IcuCalendarBackend::DateUntil(
    CalendarKind /*kind*/, const IsoDate& /*earlier*/,
    const IsoDate& /*later*/, Unit /*largest_unit*/) noexcept {
  return TemporalError::Range(
      "ICU calendar backend requires V8_INTL_SUPPORT to be enabled");
}
TemporalResult<uint8_t> IcuCalendarBackend::DaysInMonth(
    CalendarKind /*kind*/, const IsoDate& /*iso*/) noexcept {
  return TemporalError::Range(
      "ICU calendar backend requires V8_INTL_SUPPORT to be enabled");
}
TemporalResult<uint16_t> IcuCalendarBackend::DaysInYear(
    CalendarKind /*kind*/, const IsoDate& /*iso*/) noexcept {
  return TemporalError::Range(
      "ICU calendar backend requires V8_INTL_SUPPORT to be enabled");
}
TemporalResult<uint8_t> IcuCalendarBackend::MonthsInYear(
    CalendarKind /*kind*/, const IsoDate& /*iso*/) noexcept {
  return TemporalError::Range(
      "ICU calendar backend requires V8_INTL_SUPPORT to be enabled");
}
TemporalResult<uint8_t> IcuCalendarBackend::DaysInWeek(
    CalendarKind /*kind*/, const IsoDate& /*iso*/) noexcept {
  return uint8_t{7};
}
TemporalResult<std::string> IcuCalendarBackend::MonthCode(
    CalendarKind /*kind*/, const IsoDate& /*iso*/) noexcept {
  return TemporalError::Range(
      "ICU calendar backend requires V8_INTL_SUPPORT to be enabled");
}
TemporalResult<std::string> IcuCalendarBackend::Era(
    CalendarKind /*kind*/, const IsoDate& /*iso*/) noexcept {
  return TemporalError::Range(
      "ICU calendar backend requires V8_INTL_SUPPORT to be enabled");
}
TemporalResult<std::optional<int32_t>> IcuCalendarBackend::EraYear(
    CalendarKind /*kind*/, const IsoDate& /*iso*/) noexcept {
  return TemporalError::Range(
      "ICU calendar backend requires V8_INTL_SUPPORT to be enabled");
}
TemporalResult<bool> IcuCalendarBackend::InLeapYear(
    CalendarKind /*kind*/, const IsoDate& /*iso*/) noexcept {
  return TemporalError::Range(
      "ICU calendar backend requires V8_INTL_SUPPORT to be enabled");
}
TemporalResult<uint8_t> IcuCalendarBackend::ResolveMonthCode(
    CalendarKind /*kind*/, int32_t /*year*/,
    const MonthCode& /*code*/) noexcept {
  return TemporalError::Range(
      "ICU calendar backend requires V8_INTL_SUPPORT to be enabled");
}

void InstallIcuCalendarBackend() noexcept {}
void InstallIcuCalendarBackendIfAvailable() noexcept {}

#endif  // V8_INTL_SUPPORT

}  // namespace temporal
}  // namespace socketsecurity
}  // namespace node
