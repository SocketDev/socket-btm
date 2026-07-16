// 1:1 port of upstream `src/builtins/core/calendar.rs` at
// temporal v0.2.3 (c003cc92325e19b26f8ee2f85e4a47d98cbcc781).
//
// Lock-step from Rust: builtins/core/calendar.rs
//
// Architectural deviation: upstream wraps ICU4X's `AnyCalendar` (a
// Rust calendar library); this C++ port delegates to the system ICU
// (`icu::Calendar` from deps/icu-small) which V8 already links. The
// public surface (Calendar class with kind enum + identifier accessor +
// per-method delegation) matches upstream 1:1; the implementation just
// dispatches into ICU C API instead of icu_calendar's Rust wrapper.
//
// Non-ISO calendar arithmetic is mediated by the `CalendarBackend`
// interface declared at the bottom of this header. The default
// backend handles ISO inline and rejects every other calendar; V8's
// js-temporal binding installs an ICU-backed override at boot.

#ifndef SRC_SOCKETSECURITY_TEMPORAL_CALENDAR_H_
#define SRC_SOCKETSECURITY_TEMPORAL_CALENDAR_H_

#include <cstddef>
#include <cstdint>
#include <optional>
#include <string>
#include <string_view>

#include "socketsecurity/temporal/error.h"
#include "socketsecurity/temporal/options.h"
#include "socketsecurity/temporal/temporal.h"

namespace node {
namespace socketsecurity {
namespace temporal {

// `CalendarKind` enum is canonically defined in temporal.h so the
// inner PODs (PlainDate { iso, calendar }, etc.) can hold a kind
// without a header cycle. This header just consumes it.

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

// Mirror of upstream's `EraCode`. Short ASCII era identifier per the
// Temporal spec's "Calendar Era Codes" table — lowercase, hyphen-
// separated. Longest known era code is "before-incarnation" (18 bytes)
// for Coptic/Ethiopian; 24 bytes gives a 25% headroom margin. Empty
// (length == 0) means "no era specified" — calendars without distinct
// eras (Chinese, Hebrew, Islamic family) return empty from Era().
//
// Layout choice: fixed-size POD (not std::string) so CalendarFields
// stays trivially copyable and fits in a small handful of cache lines.
// Comparison treats trailing zero bytes as padding.
struct Era {
  static constexpr size_t kMaxLen = 24;
  uint8_t bytes[kMaxLen] = {};
  uint8_t length = 0;

  constexpr bool IsEmpty() const noexcept { return length == 0; }

  // String view into the populated prefix. Lifetime is tied to the
  // Era struct's storage.
  std::string_view View() const noexcept {
    return std::string_view(reinterpret_cast<const char*>(bytes), length);
  }

  // Populate from a sized byte range. Truncates silently at kMaxLen —
  // any caller passing a longer era is wrong (no real era code
  // approaches 24 bytes; the truncation just keeps memory safe).
  static Era FromBytes(const uint8_t* data, size_t len) noexcept {
    Era out;
    if (len > kMaxLen) len = kMaxLen;
    for (size_t i = 0; i < len; i += 1) out.bytes[i] = data[i];
    out.length = static_cast<uint8_t>(len);
    return out;
  }

  bool operator==(const Era& other) const noexcept {
    if (length != other.length) return false;
    for (size_t i = 0; i < length; i += 1) {
      if (bytes[i] != other.bytes[i]) return false;
    }
    return true;
  }
  bool operator!=(const Era& other) const noexcept { return !(*this == other); }
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
  // era is the short ASCII era identifier per the Temporal spec's
  // "Calendar Era Codes" table (lowercase, hyphen-separated). Stored
  // as a fixed-size Era POD so CalendarFields stays trivially
  // copyable. era_year is the year *within* the era — e.g.
  // (era="reiwa", era_year=7) ↔ ISO 2025.
  Era era{};
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
  Era era{};
  bool has_era = false;
  int32_t era_year = 0;
  bool has_era_year = false;

  bool IsEmpty() const noexcept {
    return !has_year && !has_month && !has_month_code && !has_era &&
           !has_era_year;
  }
};

// Calendar arithmetic. ISO is handled inline; non-ISO calendars
// route through the active CalendarBackend (see below).

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

// Mirror of upstream's `Calendar::resolve_month_code`. Maps a
// MonthCode ("M01"…"M12" / "M05L" / "M07L" / …) to a 1-indexed
// ordinal month for the given (year, calendar). Most calendars
// have no leap-month variant; for those, leap=false codes map
// M0X → X and leap codes return Range. Hebrew uses M05L (leap
// Adar I) variant in 7 of 19 years per Metonic cycle; the call
// routes through CalendarBackend so the ICU backend can resolve
// the year-dependent mapping. Default ISO impl handles plain
// M01..M12 and rejects every leap variant.
TemporalResult<uint8_t> CalendarResolveMonthCode(
    const Calendar& cal, int32_t year, const MonthCode& code) noexcept;

// ── CalendarBackend ───────────────────────────────────────────────────
//
// Plug-in interface for non-ISO calendar resolution. The default
// backend rejects every non-ISO calendar; V8's js-temporal layer
// registers an ICU-backed override at boot.

class CalendarBackend {
 public:
  virtual ~CalendarBackend() = default;

  // Add a Duration to a calendar-aware date. Default impl rejects
  // every input.
  virtual TemporalResult<IsoDate> DateAdd(CalendarKind kind,
                                            const IsoDate& base,
                                            const Duration& duration,
                                            Overflow overflow) noexcept;

  // Compute the calendar difference between two ISO dates. Default
  // impl rejects every input.
  virtual TemporalResult<Duration> DateUntil(CalendarKind kind,
                                               const IsoDate& earlier,
                                               const IsoDate& later,
                                               Unit largest_unit) noexcept;

  // Calendar-aware field accessors. Each defaults to rejecting non-
  // ISO calendars; V8's ICU-backed override resolves them against
  // icu::Calendar.
  virtual TemporalResult<uint8_t> DaysInMonth(CalendarKind kind,
                                                const IsoDate& iso) noexcept;
  virtual TemporalResult<uint16_t> DaysInYear(CalendarKind kind,
                                                const IsoDate& iso) noexcept;
  virtual TemporalResult<uint8_t> MonthsInYear(CalendarKind kind,
                                                 const IsoDate& iso) noexcept;
  virtual TemporalResult<uint8_t> DaysInWeek(CalendarKind kind,
                                               const IsoDate& iso) noexcept;
  // Named GetMonthCodeString (not MonthCode) so it doesn't shadow the
  // MonthCode struct declared in the same namespace. Method-vs-type
  // shadow was a recurring lockstep papercut; the rename trades a
  // 1-token divergence from upstream's `month_code` for compile-time
  // hygiene across every shim header that references the struct.
  virtual TemporalResult<std::string> GetMonthCodeString(
      CalendarKind kind, const IsoDate& iso) noexcept;
  virtual TemporalResult<std::string> Era(CalendarKind kind,
                                            const IsoDate& iso) noexcept;
  virtual TemporalResult<std::optional<int32_t>> EraYear(
      CalendarKind kind, const IsoDate& iso) noexcept;
  virtual TemporalResult<bool> InLeapYear(CalendarKind kind,
                                            const IsoDate& iso) noexcept;

  // Mirror of upstream's `Calendar::resolve_month_code(year, code)`.
  // Returns the ordinal month for the given monthCode in the named
  // calendar / year. Default impl handles ISO (M01..M12 → 1..12,
  // leap variants rejected). ICU backend handles leap variants for
  // Hebrew + Chinese + Dangi calendars (the only TC39-Temporal
  // calendars with leap months).
  virtual TemporalResult<uint8_t> ResolveMonthCode(
      CalendarKind kind, int32_t year,
      const MonthCode& code) noexcept;

  // Convert (calendar_year, ordinal_month, day) in the named calendar
  // to an ISO date. The inputs are in the *calendar's* numbering:
  //   - For Hebrew: year=5784, ordinal_month=6 means Adar I (M05L) in
  //     a leap year — NOT ISO month 6.
  //   - For Coptic / Ethiopian: year=2017, ordinal_month=13 is M13.
  // The ordinal_month is post-monthCode-resolution: the caller should
  // have already routed an "M05L" through ResolveMonthCode for the
  // year to get the ICU-native ordinal position (6 for Adar I in
  // Hebrew leap, etc.).
  // Default impl handles ISO (passthrough with overflow). ICU backend
  // walks UCAL_YEAR/MONTH/DATE → getTime() → epoch_ms → IsoDate.
  virtual TemporalResult<IsoDate> IsoFromCalendarFields(
      CalendarKind kind, int32_t year, uint8_t ordinal_month,
      uint8_t day, Overflow overflow) noexcept;

  // Resolve (era, era_year) → the calendar's proleptic year. Inverse
  // of Era() + EraYear(). The "proleptic year" here means the year
  // suitable for passing back into IsoFromCalendarFields as `year`.
  //
  // Calendar-specific arithmetic (epochs lifted from
  // js-temporal/temporal-polyfill/tree/rebase-part3/lib/calendar.ts
  // and the Temporal spec):
  //   - Gregorian / Buddhist / Coptic / Ethiopian / Persian / ROC /
  //     Japanese: deterministic era → year mapping.
  //   - Hebrew / Chinese / Dangi / Islamic family: no distinct eras;
  //     era is conventionally empty. Calling with a non-empty era is
  //     an error.
  //   - ISO: no era; calling with a non-empty era is an error.
  //
  // Default impl handles ISO (errors on non-empty era). ICU backend
  // implements the full table.
  // `struct Era` tag is required: the virtual `Era(...)` method above
  // shadows the `Era` type name within this class scope, so a bare
  // `const Era&` resolves to the method, not the struct (clang:
  // "must use 'struct' tag to refer to type 'Era'").
  virtual TemporalResult<int32_t> EraYearToIsoYear(
      CalendarKind kind, const struct Era& era, int32_t era_year) noexcept;

  // Read the calendar-native year / ordinal month / day-of-month for
  // the given ISO date. The inverse of IsoFromCalendarFields — used by
  // PlainDate / PlainYearMonth / PlainMonthDay .year/.month/.day
  // accessors when the calendar is non-ISO.
  // ISO defaults to iso.year / iso.month / iso.day. ICU backend reads
  // UCAL_YEAR / UCAL_MONTH+1 / UCAL_DATE off an icu::Calendar
  // positioned at the ISO date.
  virtual TemporalResult<int32_t> Year(CalendarKind kind,
                                         const IsoDate& iso) noexcept;
  virtual TemporalResult<uint8_t> Month(CalendarKind kind,
                                          const IsoDate& iso) noexcept;
  virtual TemporalResult<uint8_t> Day(CalendarKind kind,
                                        const IsoDate& iso) noexcept;
};

// Front-door dispatch helpers — choose ISO inline or delegate to the
// backend for non-ISO. Each compat accessor on PlainDate /
// PlainDateTime / ZonedDateTime / PlainYearMonth / PlainMonthDay
// can call these instead of branching by hand.
uint8_t CalendarDaysInMonth(const Calendar& cal,
                              const IsoDate& iso) noexcept;
uint16_t CalendarDaysInYear(const Calendar& cal,
                              const IsoDate& iso) noexcept;
uint8_t CalendarMonthsInYear(const Calendar& cal,
                               const IsoDate& iso) noexcept;
uint8_t CalendarDaysInWeek(const Calendar& cal,
                             const IsoDate& iso) noexcept;
std::string CalendarMonthCode(const Calendar& cal,
                                const IsoDate& iso) noexcept;
std::string CalendarEra(const Calendar& cal, const IsoDate& iso) noexcept;
std::optional<int32_t> CalendarEraYear(const Calendar& cal,
                                         const IsoDate& iso) noexcept;
bool CalendarInLeapYear(const Calendar& cal, const IsoDate& iso) noexcept;

CalendarBackend& GetCalendarBackend() noexcept;
void SetCalendarBackend(CalendarBackend* backend) noexcept;

}  // namespace temporal
}  // namespace socketsecurity
}  // namespace node

#endif  // SRC_SOCKETSECURITY_TEMPORAL_CALENDAR_H_
