// ICU-backed CalendarBackend override.
//
// Routes non-ISO calendar operations through ICU's icu::Calendar
// (already linked into V8 with V8_INTL_SUPPORT) rather than
// re-implementing per-calendar arithmetic. Matches the pattern
// established by icu_tz_backend.{h,cc} — the V8/Chromium gold
// standard for non-ISO calendar resolution.
//
// Coverage matrix (CalendarKind → ICU locale-keyword identifier):
//   kBuddhist               → "@calendar=buddhist"
//   kChinese                → "@calendar=chinese"
//   kCoptic                 → "@calendar=coptic"
//   kDangi                  → "@calendar=dangi"
//   kEthiopian              → "@calendar=ethiopic"
//   kEthiopianAmeteAlem     → "@calendar=ethiopic-amete-alem"
//   kGregorian              → "@calendar=gregorian"
//   kHebrew                 → "@calendar=hebrew"
//   kIndian                 → "@calendar=indian"
//   kHijriTabularFriday     → "@calendar=islamic-civil"
//   kHijriTabularThursday   → "@calendar=islamic-tbla"
//   kHijriUmmAlQura         → "@calendar=islamic-umalqura"
//   kJapanese               → "@calendar=japanese"
//   kPersian                → "@calendar=persian"
//   kRoc                    → "@calendar=roc"
//
// Each virtual converts an IsoDate to ICU's UDate (epoch ms), sets
// it on the icu::Calendar instance, reads the corresponding field
// (UCAL_DAY_OF_MONTH, UCAL_DAY_OF_YEAR, UCAL_ERA, ...), and returns.
// ICU handles all leap-year + leap-month + era logic.

#ifndef SRC_SOCKETSECURITY_TEMPORAL_ICU_CAL_BACKEND_H_
#define SRC_SOCKETSECURITY_TEMPORAL_ICU_CAL_BACKEND_H_

#include "socketsecurity/temporal/calendar.h"

namespace node {
namespace socketsecurity {
namespace temporal {

class IcuCalendarBackend : public CalendarBackend {
 public:
  IcuCalendarBackend() = default;
  ~IcuCalendarBackend() override = default;

  TemporalResult<IsoDate> DateAdd(CalendarKind kind, const IsoDate& base,
                                    const Duration& duration,
                                    Overflow overflow) noexcept override;
  TemporalResult<Duration> DateUntil(CalendarKind kind,
                                       const IsoDate& earlier,
                                       const IsoDate& later,
                                       Unit largest_unit) noexcept override;

  TemporalResult<uint8_t> DaysInMonth(CalendarKind kind,
                                        const IsoDate& iso) noexcept override;
  TemporalResult<uint16_t> DaysInYear(CalendarKind kind,
                                        const IsoDate& iso) noexcept override;
  TemporalResult<uint8_t> MonthsInYear(CalendarKind kind,
                                         const IsoDate& iso) noexcept override;
  TemporalResult<uint8_t> DaysInWeek(CalendarKind kind,
                                       const IsoDate& iso) noexcept override;
  TemporalResult<std::string> GetMonthCodeString(
      CalendarKind kind, const IsoDate& iso) noexcept override;
  TemporalResult<std::string> Era(CalendarKind kind,
                                    const IsoDate& iso) noexcept override;
  TemporalResult<std::optional<int32_t>> EraYear(
      CalendarKind kind, const IsoDate& iso) noexcept override;
  TemporalResult<bool> InLeapYear(CalendarKind kind,
                                    const IsoDate& iso) noexcept override;
  TemporalResult<uint8_t> ResolveMonthCode(
      CalendarKind kind, int32_t year,
      const MonthCode& code) noexcept override;
};

// Install the ICU-backed backend as the active CalendarBackend.
// Idempotent; no-op when V8 is built without V8_INTL_SUPPORT.
void InstallIcuCalendarBackend() noexcept;
void InstallIcuCalendarBackendIfAvailable() noexcept;

}  // namespace temporal
}  // namespace socketsecurity
}  // namespace node

#endif  // SRC_SOCKETSECURITY_TEMPORAL_ICU_CAL_BACKEND_H_
