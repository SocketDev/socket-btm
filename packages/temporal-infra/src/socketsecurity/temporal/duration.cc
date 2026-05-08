// Temporal.Duration — calendar-aware time interval.
//
// The duration's `[[*]]` slots are doubles per spec, but each must be
// an integer (no NaN, no Infinity, no fractional component). Sign
// agreement: all non-zero components must share the same sign.
//
// V8 already provides DurationRecord + IsValidDuration via
// js-temporal-helpers.h — those operate on V8's internal Maybe<>
// types. Our Duration::IsValid() is a plain C++ check that doesn't
// require a V8 Isolate, so it's callable from any context.

#include "socketsecurity/temporal/temporal.h"

#include <cmath>
#include <cstdint>
#include <cstdio>
#include <string>
#include <string_view>

#include "socketsecurity/temporal/duration_normalized.h"
#include "socketsecurity/temporal/error.h"
#include "socketsecurity/temporal/utils.h"

namespace node {
namespace socketsecurity {
namespace temporal {

namespace {

// Spec helper: a double that's a finite, non-NaN integer.
bool IsIntegralDouble(double v) noexcept {
  if (std::isnan(v) || std::isinf(v)) {
    return false;
  }
  return std::trunc(v) == v;
}

// Spec helper: returns -1, 0, or +1 based on the sign of v. Treats
// `-0.0` as `0` per Temporal's "negative zero is positive zero"
// convention (spec's DurationSign). Renamed `SignOf` so it doesn't
// shadow the `Sign` enum class from duration_normalized.h.
int SignOf(double v) noexcept {
  if (v > 0.0) {
    return 1;
  }
  if (v < 0.0) {
    return -1;
  }
  return 0;
}

}  // namespace

bool Duration::IsValid() const noexcept {
  // Spec: IsValidDuration(years, months, weeks, days, hours, minutes,
  //                       seconds, milliseconds, microseconds, nanoseconds)
  //
  // 1. Set sign to ! DurationSign(...).
  // 2. For each component v: if !IsIntegralNumber(v) return false.
  // 3. For each component v: if !v.IsZero() and !SameSign(v, sign), return false.
  // 4. If abs(years) >= 2^32 return false. (Same for months, weeks.)
  // 5. Compute totalNanoseconds for time components; if it doesn't fit
  //    in MAX_SAFE_INTEGER (2^53 - 1), return false.

  const double components[] = {years,         months,       weeks,
                               days,          hours,        minutes,
                               seconds,       milliseconds, microseconds,
                               nanoseconds};

  for (double v : components) {
    if (!IsIntegralDouble(v)) {
      return false;
    }
  }

  // Establish overall sign from the first non-zero component (spec's
  // DurationSign). All other non-zero components must match.
  int overall_sign = 0;
  for (double v : components) {
    int s = SignOf(v);
    if (s != 0) {
      overall_sign = s;
      break;
    }
  }
  if (overall_sign != 0) {
    for (double v : components) {
      int s = SignOf(v);
      if (s != 0 && s != overall_sign) {
        return false;
      }
    }
  }

  // Calendar component magnitudes capped at 2^32 per spec.
  const double kCalendarMax = 4294967296.0;  // 2^32
  if (std::abs(years) >= kCalendarMax) {
    return false;
  }
  if (std::abs(months) >= kCalendarMax) {
    return false;
  }
  if (std::abs(weeks) >= kCalendarMax) {
    return false;
  }

  // Time-only nanosecond magnitude ≤ MAX_SAFE_INTEGER (2^53 - 1).
  // Compute as a double — the spec deliberately uses float math here
  // because the inputs are spec'd as doubles. Overflow is detected
  // via the Number.MAX_SAFE_INTEGER check, not by integer overflow.
  const double kNsPerUs = 1000.0;
  const double kNsPerMs = 1000.0 * kNsPerUs;
  const double kNsPerSec = 1000.0 * kNsPerMs;
  const double kNsPerMin = 60.0 * kNsPerSec;
  const double kNsPerHour = 60.0 * kNsPerMin;
  const double kNsPerDay = 24.0 * kNsPerHour;

  const double total_ns = days * kNsPerDay + hours * kNsPerHour +
                          minutes * kNsPerMin + seconds * kNsPerSec +
                          milliseconds * kNsPerMs + microseconds * kNsPerUs +
                          nanoseconds;

  // Number.MAX_SAFE_INTEGER == 2^53 - 1 == 9007199254740991.
  // Spec: abs(totalNanoseconds) ≤ MAX_SAFE_INTEGER.
  const double kMaxSafe = 9007199254740991.0;
  if (std::abs(total_ns) > kMaxSafe) {
    return false;
  }

  return true;
}

// ── Public Duration surface (spec methods) ────────────────────────────

namespace {

// Spec: DurationSign — sign of the first non-zero component, with
// magnitude order years > months > weeks > days > hours > … > ns.
int DurationSign(const Duration& d) noexcept {
  const double components[] = {d.years,        d.months,       d.weeks,
                               d.days,         d.hours,        d.minutes,
                               d.seconds,      d.milliseconds,
                               d.microseconds, d.nanoseconds};
  for (double v : components) {
    int s = SignOf(v);
    if (s != 0) {
      return s;
    }
  }
  return 0;
}

}  // namespace

Duration DurationCreate(int64_t years, int64_t months, int64_t weeks,
                         int64_t days, int64_t hours, int64_t minutes,
                         int64_t seconds, int64_t milliseconds,
                         double microseconds, double nanoseconds) noexcept {
  Duration d{};
  d.years = static_cast<double>(years);
  d.months = static_cast<double>(months);
  d.weeks = static_cast<double>(weeks);
  d.days = static_cast<double>(days);
  d.hours = static_cast<double>(hours);
  d.minutes = static_cast<double>(minutes);
  d.seconds = static_cast<double>(seconds);
  d.milliseconds = static_cast<double>(milliseconds);
  d.microseconds = microseconds;
  d.nanoseconds = nanoseconds;
  return d;
}

TemporalResult<Duration> DurationTryNew(int64_t years, int64_t months,
                                          int64_t weeks, int64_t days,
                                          int64_t hours, int64_t minutes,
                                          int64_t seconds, int64_t milliseconds,
                                          double microseconds,
                                          double nanoseconds) noexcept {
  Duration d = DurationCreate(years, months, weeks, days, hours, minutes,
                                seconds, milliseconds, microseconds,
                                nanoseconds);
  if (!d.IsValid()) {
    return TemporalError::Range("Duration is not valid");
  }
  return d;
}

Sign DurationGetSign(const Duration& d) noexcept {
  const int s = DurationSign(d);
  if (s > 0) return Sign::kPositive;
  if (s < 0) return Sign::kNegative;
  return Sign::kZero;
}

bool DurationIsZero(const Duration& d) noexcept {
  return DurationSign(d) == 0;
}

Duration DurationAbs(const Duration& d) noexcept {
  Duration out = d;
  out.years = std::abs(out.years);
  out.months = std::abs(out.months);
  out.weeks = std::abs(out.weeks);
  out.days = std::abs(out.days);
  out.hours = std::abs(out.hours);
  out.minutes = std::abs(out.minutes);
  out.seconds = std::abs(out.seconds);
  out.milliseconds = std::abs(out.milliseconds);
  out.microseconds = std::abs(out.microseconds);
  out.nanoseconds = std::abs(out.nanoseconds);
  return out;
}

Duration DurationNegated(const Duration& d) noexcept {
  Duration out = d;
  // Spec: negating treats -0 as +0, but for IsValid purposes the
  // sign agreement check ignores zero. Plain negation works.
  out.years = -out.years;
  out.months = -out.months;
  out.weeks = -out.weeks;
  out.days = -out.days;
  out.hours = -out.hours;
  out.minutes = -out.minutes;
  out.seconds = -out.seconds;
  out.milliseconds = -out.milliseconds;
  out.microseconds = -out.microseconds;
  out.nanoseconds = -out.nanoseconds;
  return out;
}

bool DurationIsTimeWithinRange(const Duration& d) noexcept {
  // Spec: time-only-nanoseconds must fit in MAX_SAFE_INTEGER. This
  // is the same check IsValid() does for the time portion; expose
  // it standalone for the spec's `is_time_within_range` accessor.
  const double kNsPerUs = 1000.0;
  const double kNsPerMs = 1000.0 * kNsPerUs;
  const double kNsPerSec = 1000.0 * kNsPerMs;
  const double kNsPerMin = 60.0 * kNsPerSec;
  const double kNsPerHour = 60.0 * kNsPerMin;
  const double kNsPerDay = 24.0 * kNsPerHour;
  const double total_ns = d.days * kNsPerDay + d.hours * kNsPerHour +
                           d.minutes * kNsPerMin + d.seconds * kNsPerSec +
                           d.milliseconds * kNsPerMs +
                           d.microseconds * kNsPerUs + d.nanoseconds;
  const double kMaxSafe = 9007199254740991.0;
  return std::abs(total_ns) <= kMaxSafe;
}

TemporalResult<Duration> DurationAdd(const Duration& self,
                                       const Duration& other) noexcept {
  // Spec: AddDurations. Both must have only the time-or-only-day
  // portions populated when no relativeTo is provided; calendar
  // components other than `days` require a relative-to anchor.
  // For the no-relative-to path: sum component-wise, then validate.
  if (self.years != 0 || self.months != 0 || self.weeks != 0 ||
      other.years != 0 || other.months != 0 || other.weeks != 0) {
    return TemporalError::Range(
        "DurationAdd without relativeTo cannot mix calendar components");
  }
  Duration sum{};
  sum.years = 0;
  sum.months = 0;
  sum.weeks = 0;
  sum.days = self.days + other.days;
  sum.hours = self.hours + other.hours;
  sum.minutes = self.minutes + other.minutes;
  sum.seconds = self.seconds + other.seconds;
  sum.milliseconds = self.milliseconds + other.milliseconds;
  sum.microseconds = self.microseconds + other.microseconds;
  sum.nanoseconds = self.nanoseconds + other.nanoseconds;
  if (!sum.IsValid()) {
    return TemporalError::Range(
        "DurationAdd produced an invalid Duration");
  }
  return sum;
}

TemporalResult<Duration> DurationSubtract(const Duration& self,
                                            const Duration& other) noexcept {
  return DurationAdd(self, DurationNegated(other));
}

// Spec: ParseTemporalDurationString (RFC 3339 duration grammar with
// Temporal extensions). Grammar:
//
//   sign?  P  date-part?  ( T  time-part )?
//
// Where date-part is `nY` `nM` `nW` `nD` (any subset, in order; each
// component optional but at least one in date-part OR time-part required),
// and time-part is `nH` `nM` `nS` (with optional fractional seconds —
// up to 9 digits — splitting into milliseconds/microseconds/nanoseconds).
//
// Returns a Duration with all components zeroed except those parsed.
// Failure returns TemporalError::Range.
namespace {

bool ParseUInt(std::string_view& s, double* out) noexcept {
  if (s.empty() || s[0] < '0' || s[0] > '9') return false;
  uint64_t value = 0;
  size_t consumed = 0;
  while (consumed < s.size() && s[consumed] >= '0' && s[consumed] <= '9') {
    value = value * 10 + static_cast<uint64_t>(s[consumed] - '0');
    consumed++;
  }
  s.remove_prefix(consumed);
  *out = static_cast<double>(value);
  return true;
}

bool ParseFraction(std::string_view& s, double* out_subseconds) noexcept {
  // Already consumed the '.' / ',' separator; parse 1..9 digits and
  // return as a nanosecond count (right-padded with zeros).
  if (s.empty() || s[0] < '0' || s[0] > '9') return false;
  uint64_t value = 0;
  size_t consumed = 0;
  while (consumed < 9 && consumed < s.size() && s[consumed] >= '0' &&
         s[consumed] <= '9') {
    value = value * 10 + static_cast<uint64_t>(s[consumed] - '0');
    consumed++;
  }
  // Pad to 9 digits.
  for (size_t i = consumed; i < 9; i++) value *= 10;
  // Reject any further digits after the first 9.
  if (consumed < s.size() && s[consumed] >= '0' && s[consumed] <= '9') {
    return false;
  }
  s.remove_prefix(consumed);
  *out_subseconds = static_cast<double>(value);
  return true;
}

}  // namespace

TemporalResult<Duration> DurationFromUtf8(std::string_view input) noexcept {
  std::string_view s = input;
  if (s.empty()) {
    return TemporalError::Range("empty duration string");
  }
  int sign = 1;
  if (s[0] == '+' || s[0] == '-' ||
      static_cast<unsigned char>(s[0]) == 0xE2 /* leading u+2212 */) {
    if (s[0] == '-') sign = -1;
    s.remove_prefix(1);
  }
  if (s.empty() || (s[0] != 'P' && s[0] != 'p')) {
    return TemporalError::Range("expected 'P' designator");
  }
  s.remove_prefix(1);

  Duration d{};

  // Date-part: parse digits then look for designator (Y/M/W/D, in that
  // order). Each may appear at most once, in order.
  enum class DateDes { kY, kMo, kW, kD, kNone };
  DateDes max_seen = DateDes::kNone;
  while (!s.empty() && s[0] != 'T' && s[0] != 't') {
    double value = 0;
    if (!ParseUInt(s, &value)) {
      return TemporalError::Range("expected digit in duration date-part");
    }
    if (s.empty()) {
      return TemporalError::Range("missing designator after digits");
    }
    char des = s[0];
    s.remove_prefix(1);
    DateDes which;
    switch (des) {
      case 'Y': case 'y': which = DateDes::kY; break;
      case 'M': case 'm': which = DateDes::kMo; break;
      case 'W': case 'w': which = DateDes::kW; break;
      case 'D': case 'd': which = DateDes::kD; break;
      default:
        return TemporalError::Range("unknown date-part designator");
    }
    if (max_seen != DateDes::kNone && static_cast<int>(which) <=
                                          static_cast<int>(max_seen)) {
      return TemporalError::Range("duration designators out of order");
    }
    max_seen = which;
    switch (which) {
      case DateDes::kY: d.years = value; break;
      case DateDes::kMo: d.months = value; break;
      case DateDes::kW: d.weeks = value; break;
      case DateDes::kD: d.days = value; break;
      case DateDes::kNone: break;
    }
  }

  // Time-part: optional `T` then h/m/s with optional fractional on the
  // last seen designator.
  if (!s.empty() && (s[0] == 'T' || s[0] == 't')) {
    s.remove_prefix(1);
    if (s.empty()) {
      return TemporalError::Range("'T' with no time components");
    }
    enum class TimeDes { kH, kM, kS, kNone };
    TimeDes max_t = TimeDes::kNone;
    while (!s.empty()) {
      double value = 0;
      if (!ParseUInt(s, &value)) {
        return TemporalError::Range("expected digit in duration time-part");
      }
      double frac = 0;
      bool has_frac = false;
      if (!s.empty() && (s[0] == '.' || s[0] == ',')) {
        s.remove_prefix(1);
        if (!ParseFraction(s, &frac)) {
          return TemporalError::Range("invalid fractional seconds");
        }
        has_frac = true;
      }
      if (s.empty()) {
        return TemporalError::Range("missing designator in time-part");
      }
      char des = s[0];
      s.remove_prefix(1);
      TimeDes which;
      switch (des) {
        case 'H': case 'h': which = TimeDes::kH; break;
        case 'M': case 'm': which = TimeDes::kM; break;
        case 'S': case 's': which = TimeDes::kS; break;
        default:
          return TemporalError::Range("unknown time-part designator");
      }
      if (max_t != TimeDes::kNone && static_cast<int>(which) <=
                                          static_cast<int>(max_t)) {
        return TemporalError::Range("duration time designators out of order");
      }
      max_t = which;
      // Fractional only valid on the most-precise component used.
      if (has_frac && which == TimeDes::kH) {
        // Convert frac (ns) into the lower-precision components.
        double total_ns = frac;
        double total_min = value * 60.0;
        double extra_min = std::trunc(total_ns / 60'000'000'000.0);
        d.hours = 0;
        d.minutes = total_min + extra_min;
        // Push remainder down.
        double rem_ns = total_ns - extra_min * 60'000'000'000.0;
        d.seconds = std::trunc(rem_ns / 1'000'000'000.0);
        rem_ns -= d.seconds * 1'000'000'000.0;
        d.milliseconds = std::trunc(rem_ns / 1'000'000.0);
        rem_ns -= d.milliseconds * 1'000'000.0;
        d.microseconds = std::trunc(rem_ns / 1'000.0);
        d.nanoseconds = rem_ns - d.microseconds * 1'000.0;
        d.hours = value;
        // Recompute since we overwrote.
      } else if (has_frac && which == TimeDes::kM) {
        d.minutes = value;
        double rem_ns = frac;
        d.seconds = std::trunc(rem_ns / 1'000'000'000.0);
        rem_ns -= d.seconds * 1'000'000'000.0;
        d.milliseconds = std::trunc(rem_ns / 1'000'000.0);
        rem_ns -= d.milliseconds * 1'000'000.0;
        d.microseconds = std::trunc(rem_ns / 1'000.0);
        d.nanoseconds = rem_ns - d.microseconds * 1'000.0;
      } else if (has_frac && which == TimeDes::kS) {
        d.seconds = value;
        double rem_ns = frac;
        d.milliseconds = std::trunc(rem_ns / 1'000'000.0);
        rem_ns -= d.milliseconds * 1'000'000.0;
        d.microseconds = std::trunc(rem_ns / 1'000.0);
        d.nanoseconds = rem_ns - d.microseconds * 1'000.0;
      } else {
        switch (which) {
          case TimeDes::kH: d.hours = value; break;
          case TimeDes::kM: d.minutes = value; break;
          case TimeDes::kS: d.seconds = value; break;
          case TimeDes::kNone: break;
        }
      }
    }
  }

  if (sign < 0) {
    d = DurationNegated(d);
  }
  if (!d.IsValid()) {
    return TemporalError::Range("parsed duration out of range");
  }
  return d;
}

// Spec: TemporalDurationToString. Produces the canonical IXDTF
// representation (no rounding here — caller resolves rounding via
// Duration::Round + ToStringRoundingOptions before calling).
std::string DurationToString(const Duration& d) noexcept {
  std::string out;
  // Determine sign — if negative, emit "-" prefix and emit absolute
  // values for components.
  Duration abs_d = DurationAbs(d);
  bool negative = false;
  for (double v : {d.years, d.months, d.weeks, d.days, d.hours, d.minutes,
                    d.seconds, d.milliseconds, d.microseconds,
                    d.nanoseconds}) {
    if (v < 0) {
      negative = true;
      break;
    }
  }
  if (negative) out.push_back('-');
  out.push_back('P');
  bool any_date = false;
  auto emit_int = [&](double v, char des) {
    if (v != 0) {
      char buf[32];
      auto n = static_cast<unsigned long long>(v);
      int len = std::snprintf(buf, sizeof(buf), "%llu%c", n, des);
      out.append(buf, len);
      any_date = true;
    }
  };
  emit_int(abs_d.years, 'Y');
  emit_int(abs_d.months, 'M');
  emit_int(abs_d.weeks, 'W');
  emit_int(abs_d.days, 'D');

  // Time-part with fractional seconds.
  bool any_time = abs_d.hours != 0 || abs_d.minutes != 0 ||
                  abs_d.seconds != 0 || abs_d.milliseconds != 0 ||
                  abs_d.microseconds != 0 || abs_d.nanoseconds != 0;
  if (any_time) {
    out.push_back('T');
    if (abs_d.hours != 0) {
      char buf[32];
      int len = std::snprintf(buf, sizeof(buf), "%lluH",
                                static_cast<unsigned long long>(abs_d.hours));
      out.append(buf, len);
    }
    if (abs_d.minutes != 0) {
      char buf[32];
      int len =
          std::snprintf(buf, sizeof(buf), "%lluM",
                          static_cast<unsigned long long>(abs_d.minutes));
      out.append(buf, len);
    }
    if (abs_d.seconds != 0 || abs_d.milliseconds != 0 ||
        abs_d.microseconds != 0 || abs_d.nanoseconds != 0) {
      double total_subsec_ns = abs_d.milliseconds * 1'000'000.0 +
                                  abs_d.microseconds * 1'000.0 +
                                  abs_d.nanoseconds;
      char buf[32];
      int len = std::snprintf(buf, sizeof(buf), "%llu",
                                static_cast<unsigned long long>(abs_d.seconds));
      out.append(buf, len);
      if (total_subsec_ns != 0) {
        // Emit up to 9 fractional digits, trimming trailing zeros.
        out.push_back('.');
        char fbuf[12];
        std::snprintf(fbuf, sizeof(fbuf), "%09llu",
                       static_cast<unsigned long long>(total_subsec_ns));
        std::string_view fs(fbuf);
        while (!fs.empty() && fs.back() == '0') fs.remove_suffix(1);
        out.append(fs.data(), fs.size());
      }
      out.push_back('S');
    }
  }

  // If no components at all, output `PT0S`.
  if (!any_date && !any_time) {
    out.append("T0S");
  }
  return out;
}

// Spec: TotalDurationNanoseconds — sum the time-portion as a double.
// Returns the spec's "totalNanoseconds" used by Duration.compare and
// Duration.total. Calendar components (years/months/weeks) are NOT
// included; the caller validates they're zero or routes through a
// relativeTo anchor.
double DurationTotalNanoseconds(const Duration& d) noexcept {
  const double kNsPerUs = 1000.0;
  const double kNsPerMs = 1000.0 * kNsPerUs;
  const double kNsPerSec = 1000.0 * kNsPerMs;
  const double kNsPerMin = 60.0 * kNsPerSec;
  const double kNsPerHour = 60.0 * kNsPerMin;
  const double kNsPerDay = 24.0 * kNsPerHour;
  return d.days * kNsPerDay + d.hours * kNsPerHour +
         d.minutes * kNsPerMin + d.seconds * kNsPerSec +
         d.milliseconds * kNsPerMs + d.microseconds * kNsPerUs +
         d.nanoseconds;
}

// Spec: CompareDurations (no relativeTo). For the time-only path,
// compares totalNanoseconds; calendar components require a relativeTo
// anchor — caller surfaces a Range error if either side has any.
TemporalResult<int8_t> DurationCompare(const Duration& a,
                                          const Duration& b) noexcept {
  if (a.years != 0 || a.months != 0 || a.weeks != 0 || b.years != 0 ||
      b.months != 0 || b.weeks != 0) {
    return TemporalError::Range(
        "DurationCompare requires relativeTo for calendar components");
  }
  double na = DurationTotalNanoseconds(a);
  double nb = DurationTotalNanoseconds(b);
  if (na < nb) return static_cast<int8_t>(-1);
  if (na > nb) return static_cast<int8_t>(1);
  return static_cast<int8_t>(0);
}

}  // namespace temporal
}  // namespace socketsecurity
}  // namespace node
