// 1:1 port of upstream `src/builtins/core/calendar.rs` at
// temporal v0.2.3 (c003cc92325e19b26f8ee2f85e4a47d98cbcc781).
//
// Architectural deviation: upstream wraps ICU4X's `AnyCalendar` (a
// Rust calendar library); this C++ port delegates to the system ICU
// (`icu::Calendar` from deps/icu-small) which V8 already links. The
// public surface (Calendar class with kind enum + identifier accessor +
// per-method delegation) matches upstream 1:1; the implementation just
// dispatches into ICU C API instead of icu_calendar's Rust wrapper.
//
// SCAFFOLD: this header defines the type surface. The non-ISO method
// implementations stub to TemporalError until the ICU dispatch layer
// lands (a separate phase). ISO calendar (which doesn't need ICU)
// works through this same surface today.

#ifndef SRC_SOCKETSECURITY_TEMPORAL_CALENDAR_H_
#define SRC_SOCKETSECURITY_TEMPORAL_CALENDAR_H_

#include <cstddef>
#include <cstdint>
#include <string_view>

#include "socketsecurity/temporal/error.h"
#include "socketsecurity/temporal/options.h"
#include "socketsecurity/temporal/temporal.h"

namespace node {
namespace socketsecurity {
namespace temporal {

// Mirror of upstream's `AnyCalendarKind` enum (subset that Temporal
// supports, per the spec's allowed calendar identifiers). Values are
// stable IDs the C++ port uses to dispatch into ICU.
enum class CalendarKind : uint8_t {
  kIso = 0,  // default
  kBuddhist,
  kChinese,
  kCoptic,
  kDangi,
  kEthiopian,
  kEthiopianAmeteAlem,
  kGregorian,
  kHebrew,
  kIndian,
  kHijriTabularFriday,
  kHijriTabularThursday,
  kHijriUmmAlQura,
  kJapanese,
  kPersian,
  kRoc,
};

// Mirror of upstream's `MonthCode`. A 4-byte ASCII string of the form
// "M01"…"M12", or "M13L" for a leap month (Hebrew calendar, etc.).
// Upstream uses TinyAsciiStr<4>; here we use a fixed-size POD that
// fits in a register.
struct MonthCode {
  // Byte layout: 'M' + month tens + month ones + (optional 'L' for leap)
  // Unused trailing bytes are 0.
  uint8_t bytes[4] = {0, 0, 0, 0};

  // Returns the month as a 1-indexed integer (1..13). Leap-month flag
  // not exposed here — caller checks bytes[3] == 'L'.
  constexpr uint8_t Month() const noexcept {
    return static_cast<uint8_t>((bytes[1] - '0') * 10 + (bytes[2] - '0'));
  }
  constexpr bool IsLeap() const noexcept { return bytes[3] == 'L'; }
};

// Mirror of upstream's `Calendar` struct.
class Calendar {
 public:
  constexpr Calendar() noexcept : kind_(CalendarKind::kIso) {}
  explicit constexpr Calendar(CalendarKind kind) noexcept : kind_(kind) {}

  static constexpr Calendar Iso() noexcept {
    return Calendar(CalendarKind::kIso);
  }

  CalendarKind Kind() const noexcept { return kind_; }
  bool IsIso() const noexcept { return kind_ == CalendarKind::kIso; }

  // Mirror of upstream's `try_from_utf8` / `try_kind_from_utf8`.
  static TemporalResult<Calendar> TryFromUtf8(const uint8_t* data,
                                                size_t length) noexcept;
  static TemporalResult<CalendarKind> TryKindFromUtf8(
      const uint8_t* data, size_t length) noexcept;

  // Mirror of upstream's `identifier`. Returns the canonical lowercase
  // IANA calendar name ("iso8601", "gregorian", "hebrew", …).
  std::string_view Identifier() const noexcept;

  bool operator==(const Calendar& other) const noexcept {
    return kind_ == other.kind_;
  }
  bool operator!=(const Calendar& other) const noexcept {
    return kind_ != other.kind_;
  }

 private:
  CalendarKind kind_;
};

// Mirror of upstream's `CalendarFields`. Fields the spec carries
// through the calendar API surface.
struct CalendarFields {
  // ISO-extended (proleptic) year.
  // Optional<i32> in upstream — std::optional in C++.
  // We lift the std::optional includes from options.h.
  // (No std::optional declared here to keep the header lightweight;
  // use options.h's transitively.)
  // year/month/day are the most common; era/era_year/month_code are
  // calendar-extension fields that only matter for non-ISO calendars.
  int32_t year = 0;
  bool has_year = false;
  uint8_t month = 0;
  bool has_month = false;
  MonthCode month_code{};
  bool has_month_code = false;
  uint8_t day = 0;
  bool has_day = false;
  // era/era_year are short ASCII strings — ported as uint8_t arrays
  // when needed by callers; for now we keep flags only.
  bool has_era = false;
  int32_t era_year = 0;
  bool has_era_year = false;

  bool IsEmpty() const noexcept {
    return !has_year && !has_month && !has_month_code && !has_day &&
           !has_era && !has_era_year;
  }
};

// Mirror of upstream's `YearMonthCalendarFields` (subset without day).
struct YearMonthCalendarFields {
  int32_t year = 0;
  bool has_year = false;
  uint8_t month = 0;
  bool has_month = false;
  MonthCode month_code{};
  bool has_month_code = false;
  bool has_era = false;
  int32_t era_year = 0;
  bool has_era_year = false;

  bool IsEmpty() const noexcept {
    return !has_year && !has_month && !has_month_code && !has_era &&
           !has_era_year;
  }
};

// Calendar arithmetic — currently ISO-only path; non-ISO paths route
// through ICU once those bindings land.

// Mirror of upstream's `Calendar::date_add`.
TemporalResult<PlainDate> CalendarDateAdd(const Calendar& cal,
                                            const IsoDate& base,
                                            const Duration& duration,
                                            Overflow overflow) noexcept;

// Mirror of upstream's `Calendar::date_until`. Largest-unit gates
// year/month/week vs day output.
TemporalResult<Duration> CalendarDateUntil(const Calendar& cal,
                                             const IsoDate& earlier,
                                             const IsoDate& later,
                                             Unit largest_unit) noexcept;

}  // namespace temporal
}  // namespace socketsecurity
}  // namespace node

#endif  // SRC_SOCKETSECURITY_TEMPORAL_CALENDAR_H_
