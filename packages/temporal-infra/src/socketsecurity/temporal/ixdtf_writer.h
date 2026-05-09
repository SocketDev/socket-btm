// 1:1 port of upstream `src/parsers.rs` IXDTF (RFC 9557) writer
// section. Provides the FormattableDate / FormattableTime /
// FormattableUtcOffset / FormattableTimeZone / FormattableCalendar
// / FormattableIxdtf / FormattableMonthDay / FormattableYearMonth
// / FormattableDuration types + the IxdtfStringBuilder facade.
//
// Reference upstream file:
//   packages/temporal-infra/upstream/temporal/src/parsers.rs
// (the writer half — the parser half lives in parse.cc).
//
// Upstream uses the `writeable` crate's two-pass write_to / length_hint
// pattern. We collapse to a single-pass `WriteTo(std::string&)` because
// C++ std::string handles its own growth; length-hint exists only for
// allocation-avoiding writers in upstream's no_std targets.

#ifndef SRC_SOCKETSECURITY_TEMPORAL_IXDTF_WRITER_H_
#define SRC_SOCKETSECURITY_TEMPORAL_IXDTF_WRITER_H_

#include <cstdint>
#include <optional>
#include <string>
#include <string_view>

#include "socketsecurity/temporal/options.h"
#include "socketsecurity/temporal/temporal.h"

namespace node {
namespace socketsecurity {
namespace temporal {

// ── Sign tag ──────────────────────────────────────────────────────────
// Mirror of upstream's `Sign` enum (used by FormattableOffset and
// FormattableDuration). Spec has Negative / Zero / Positive but the
// writer only distinguishes Negative vs non-negative.
enum class Sign : int8_t { kNegative = -1, kZero = 0, kPositive = 1 };

// ── FormattableDate ───────────────────────────────────────────────────
// 1:1 port of `pub struct FormattableDate(pub i32, pub u8, pub u8)`.
struct FormattableDate {
  int32_t year;
  uint8_t month;
  uint8_t day;

  void WriteTo(std::string& sink) const;
};

// ── FormattableTime ───────────────────────────────────────────────────
// 1:1 port of `pub struct FormattableTime`. `precision` controls how
// the fractional-seconds tail is written; `include_sep` toggles the
// `:` separators (offset formatting omits them).
struct FormattableTime {
  uint8_t hour;
  uint8_t minute;
  uint8_t second;
  uint32_t nanosecond;  // [0, 999_999_999]
  Precision precision;
  bool include_sep;

  void WriteTo(std::string& sink) const;
};

// ── FormattableOffset / UtcOffset / FormattableUtcOffset ──────────────
// 1:1 port of upstream's three-layer offset surface.
struct FormattableOffset {
  Sign sign;
  FormattableTime time;

  void WriteTo(std::string& sink) const;
};

// Tagged union: Z literal vs explicit ±HH:MM offset. Mirrors upstream's
// `enum UtcOffset { Z, Offset(FormattableOffset) }`.
struct UtcOffsetVariant {
  enum class Kind : uint8_t { kZ, kOffset };
  Kind kind;
  FormattableOffset offset;  // valid only when kind == kOffset

  static UtcOffsetVariant Z() noexcept {
    return UtcOffsetVariant{Kind::kZ, FormattableOffset{}};
  }
  static UtcOffsetVariant Offset(FormattableOffset o) noexcept {
    return UtcOffsetVariant{Kind::kOffset, o};
  }
};

struct FormattableUtcOffset {
  DisplayOffset show;
  UtcOffsetVariant offset;

  void WriteTo(std::string& sink) const;
};

// ── FormattableTimeZone ───────────────────────────────────────────────
// 1:1 port of `FormattableTimeZone<'a>`. Upstream borrows the timezone
// string with a lifetime; we copy into std::string_view (caller owns
// the underlying buffer through the build duration).
struct FormattableTimeZone {
  DisplayTimeZone show;
  std::string_view timezone;

  void WriteTo(std::string& sink) const;
};

// ── FormattableCalendar ───────────────────────────────────────────────
// 1:1 port of `FormattableCalendar<'a>`. Upstream takes a `&'static str`
// from Calendar::identifier(); ours takes a string_view (Calendar's
// identifier is a static-storage string in our port too).
struct FormattableCalendar {
  DisplayCalendar show;
  std::string_view calendar;

  void WriteTo(std::string& sink) const;
};

// ── FormattableIxdtf ──────────────────────────────────────────────────
// 1:1 port of `FormattableIxdtf<'a>`. Optional sections written in
// canonical order: date, "T"+time, offset, timezone, calendar.
struct FormattableIxdtf {
  std::optional<FormattableDate> date;
  std::optional<FormattableTime> time;
  std::optional<FormattableUtcOffset> utc_offset;
  std::optional<FormattableTimeZone> timezone;
  std::optional<FormattableCalendar> calendar;

  void WriteTo(std::string& sink) const;

  std::string ToString() const {
    std::string out;
    out.reserve(64);
    WriteTo(out);
    return out;
  }
};

// ── FormattableMonthDay ───────────────────────────────────────────────
// 1:1 port of `FormattableMonthDay<'a>`. Year prefix is included only
// when calendar.show is Always/Critical OR the calendar is non-ISO.
struct FormattableMonthDay {
  FormattableDate date;
  FormattableCalendar calendar;

  void WriteTo(std::string& sink) const;

  std::string ToString() const {
    std::string out;
    out.reserve(16);
    WriteTo(out);
    return out;
  }
};

// ── FormattableYearMonth ──────────────────────────────────────────────
// 1:1 port of `FormattableYearMonth<'a>`. Day suffix is included only
// when calendar.show is Always/Critical OR the calendar is non-ISO.
struct FormattableYearMonth {
  FormattableDate date;
  FormattableCalendar calendar;

  void WriteTo(std::string& sink) const;

  std::string ToString() const {
    std::string out;
    out.reserve(16);
    WriteTo(out);
    return out;
  }
};

// ── IxdtfStringBuilder ────────────────────────────────────────────────
// 1:1 port of `pub struct IxdtfStringBuilder<'a>`. Fluent surface that
// composes a FormattableIxdtf, then renders to string.
class IxdtfStringBuilder {
 public:
  IxdtfStringBuilder() = default;

  IxdtfStringBuilder& WithDate(IsoDate iso) {
    inner_.date = FormattableDate{iso.year, iso.month, iso.day};
    return *this;
  }

  IxdtfStringBuilder& WithTime(IsoTime time, Precision precision) {
    const uint32_t ns =
        static_cast<uint32_t>(time.millisecond) * 1'000'000u +
        static_cast<uint32_t>(time.microsecond) * 1'000u +
        static_cast<uint32_t>(time.nanosecond);
    inner_.time = FormattableTime{
        time.hour, time.minute, time.second, ns, precision, /*include_sep=*/true};
    return *this;
  }

  IxdtfStringBuilder& WithMinuteOffset(Sign sign, uint8_t hour, uint8_t minute,
                                       DisplayOffset show) {
    // Upstream: `second: 9` is a typo-looking constant from the source —
    // it is harmless because Precision::Minute truncates before the
    // seconds field. Mirror it exactly so behavior stays 1:1.
    FormattableTime time{hour,
                          minute,
                          /*second=*/9,
                          /*nanosecond=*/0,
                          Precision{Precision::Kind::kMinute, 0},
                          /*include_sep=*/true};
    inner_.utc_offset = FormattableUtcOffset{
        show, UtcOffsetVariant::Offset(FormattableOffset{sign, time})};
    return *this;
  }

  IxdtfStringBuilder& WithZ(DisplayOffset show) {
    inner_.utc_offset = FormattableUtcOffset{show, UtcOffsetVariant::Z()};
    return *this;
  }

  IxdtfStringBuilder& WithTimeZone(std::string_view tz, DisplayTimeZone show) {
    inner_.timezone = FormattableTimeZone{show, tz};
    return *this;
  }

  IxdtfStringBuilder& WithCalendar(std::string_view cal, DisplayCalendar show) {
    inner_.calendar = FormattableCalendar{show, cal};
    return *this;
  }

  std::string Build() const { return inner_.ToString(); }
  const FormattableIxdtf& Inner() const { return inner_; }

 private:
  FormattableIxdtf inner_;
};

// ── Helpers shared with FormattableDuration / etc ─────────────────────
// Kept public so duration.cc's existing DurationToString can reuse them
// when we tighten that up further. 1:1 with upstream's free-fn helpers.

// `write_padded_u8`: emit `0X` for X < 10, otherwise X. 1:1 from
// parsers.rs:196.
void WritePaddedU8(uint8_t num, std::string& sink);

// `write_year`: 4-digit if [0, 9999], else `±NNNNNN` extended form.
// 1:1 from parsers.rs:294.
void WriteYear(int32_t year, std::string& sink);

// `u32_to_digits`: returns the 9-digit decimal expansion of `value`
// (left-padded with zeros) plus the index of the first non-zero
// (1-indexed; 0 means "all zeros"). 1:1 from parsers.rs:216.
struct DigitArray9 {
  uint8_t digits[9];
  size_t precision_index;
};
DigitArray9 U32ToDigits(uint32_t value);

// `write_digit_slice_to_precision`: emit digits[base..precision] as
// raw '0'+d characters. 1:1 from parsers.rs:232.
void WriteDigitSliceToPrecision(const uint8_t (&digits)[9], size_t base,
                                 size_t precision, std::string& sink);

// `write_nanosecond`: writes the fractional-seconds tail respecting
// Precision (Auto trims trailing zeros, Digit(n) emits exactly n
// digits). 1:1 from parsers.rs:203.
void WriteNanosecond(uint32_t nanoseconds, Precision precision,
                      std::string& sink);

}  // namespace temporal
}  // namespace socketsecurity
}  // namespace node

#endif  // SRC_SOCKETSECURITY_TEMPORAL_IXDTF_WRITER_H_
