// 1:1 port of upstream `src/builtins/core/time_zone.rs`.
//
// IANA-zone resolution is mediated by the TimeZoneBackend interface.
// The default backend rejects every IANA identifier; V8's js-temporal
// binding installs an `IANATimeZoneBackend` at boot that delegates
// to `icu::TimeZone` and the zoneinfo64 transition table.

#include "socketsecurity/temporal/time_zone.h"

#include <atomic>
#include <cstdio>

#include "socketsecurity/temporal/parse.h"
#include "socketsecurity/temporal/utils.h"

namespace node {
namespace socketsecurity {
namespace temporal {

TemporalResult<UtcOffset> UtcOffset::FromUtf8(const uint8_t* data,
                                                size_t length) noexcept {
  // Lean on parse.cc's offset parser. ParseOffsetInto isn't exposed
  // publicly today; we emulate it by parsing a fake datetime "1970-01-01T00:00:00<offset>".
  // For now, support the most common shapes inline.
  if (length == 1 && (data[0] == 'Z' || data[0] == 'z')) {
    return UtcOffset(0);
  }
  if (length < 3 || (data[0] != '+' && data[0] != '-')) {
    return TemporalError::Range("Invalid UTC offset");
  }
  const int sign = (data[0] == '+') ? 1 : -1;
  // Read 2 hours.
  if (data[1] < '0' || data[1] > '9' || data[2] < '0' || data[2] > '9') {
    return TemporalError::Range("Invalid UTC offset (hours)");
  }
  const int hh = (data[1] - '0') * 10 + (data[2] - '0');
  int mm = 0;
  int ss = 0;
  size_t i = 3;
  if (i < length) {
    if (data[i] == ':') ++i;
    if (i + 1 < length && data[i] >= '0' && data[i] <= '9' &&
        data[i + 1] >= '0' && data[i + 1] <= '9') {
      mm = (data[i] - '0') * 10 + (data[i + 1] - '0');
      i += 2;
      if (i < length) {
        if (data[i] == ':') ++i;
        if (i + 1 < length && data[i] >= '0' && data[i] <= '9' &&
            data[i + 1] >= '0' && data[i + 1] <= '9') {
          ss = (data[i] - '0') * 10 + (data[i + 1] - '0');
          i += 2;
        }
      }
    }
  }
  if (hh > 23 || mm > 59 || ss > 59) {
    return TemporalError::Range("UTC offset out of range");
  }
  // Optional fractional-second part per RFC 9557 (1..9 digits, padded
  // to 9 to yield nanoseconds).
  int64_t frac_ns = 0;
  if (i < length && (data[i] == '.' || data[i] == ',')) {
    ++i;
    int read = 0;
    while (read < 9 && i < length && data[i] >= '0' && data[i] <= '9') {
      frac_ns = frac_ns * 10 + (data[i] - '0');
      ++read;
      ++i;
    }
    if (read == 0) {
      return TemporalError::Range("UTC offset fraction has no digits");
    }
    // Pad to 9 digits.
    for (int p = read; p < 9; ++p) {
      frac_ns *= 10;
    }
  }
  if (i != length) {
    return TemporalError::Range("Trailing garbage after UTC offset");
  }
  const int64_t total_seconds = static_cast<int64_t>(hh) * 3600 +
                                 static_cast<int64_t>(mm) * 60 + ss;
  return UtcOffset(sign *
                   (total_seconds * 1'000'000'000LL + frac_ns));
}

std::string UtcOffset::ToString() const {
  // Upstream renders trailing-second/sub-second only when non-zero, and
  // always uses ±HH:MM at minimum. We follow that rule.
  const int64_t abs_ns = nanoseconds_ < 0 ? -nanoseconds_ : nanoseconds_;
  const char sign = nanoseconds_ < 0 ? '-' : '+';
  const int64_t total_seconds = abs_ns / 1'000'000'000LL;
  const int hour = static_cast<int>(total_seconds / 3600);
  const int minute = static_cast<int>((total_seconds / 60) % 60);
  const int second = static_cast<int>(total_seconds % 60);
  const int64_t sub_ns = abs_ns % 1'000'000'000LL;

  char buf[32];
  if (sub_ns != 0) {
    // Trim trailing zeros from the 9-digit fraction.
    char frac[10];
    std::snprintf(frac, sizeof(frac), "%09lld",
                   static_cast<long long>(sub_ns));
    int frac_len = 9;
    while (frac_len > 1 && frac[frac_len - 1] == '0') {
      --frac_len;
    }
    frac[frac_len] = '\0';
    std::snprintf(buf, sizeof(buf), "%c%02d:%02d:%02d.%s", sign, hour, minute,
                   second, frac);
  } else if (second != 0) {
    std::snprintf(buf, sizeof(buf), "%c%02d:%02d:%02d", sign, hour, minute,
                   second);
  } else {
    std::snprintf(buf, sizeof(buf), "%c%02d:%02d", sign, hour, minute);
  }
  return std::string(buf);
}

TemporalResult<TimeZone> TimeZone::TryFromIdentifierStr(
    std::string_view identifier) noexcept {
  if (identifier.empty()) {
    return TemporalError::Range("Empty time zone identifier");
  }
  // Offset-only path: starts with +/-/Z/z.
  if (identifier == "Z" || identifier == "z" || identifier[0] == '+' ||
      identifier[0] == '-') {
    auto offset = UtcOffset::FromUtf8(
        reinterpret_cast<const uint8_t*>(identifier.data()),
        identifier.size());
    if (!offset.ok()) {
      return offset.error();
    }
    return TimeZone::FromOffset(offset.value());
  }
  // IANA path: canonicalize via the active backend.
  auto canonical = GetTimeZoneBackend().CanonicalizeIdentifier(identifier);
  if (!canonical.ok()) {
    return canonical.error();
  }
  TimeZone tz;
  tz.kind_ = Kind::kIanaIdentifier;
  tz.iana_id_ = std::move(canonical.value());
  return tz;
}

std::string TimeZone::Identifier() const {
  if (kind_ == Kind::kOffsetOnly) {
    return offset_.ToString();
  }
  return iana_id_;
}

TemporalResult<IsoDateTime> TimeZone::GetIsoDateTimeFor(
    const Instant& instant) const noexcept {
  if (kind_ != Kind::kOffsetOnly) {
    // IANA path: delegate to the active backend.
    return GetTimeZoneBackend().GetIsoDateTimeFor(iana_id_, instant);
  }
  // Offset-only path. Add the offset to the instant; convert resulting
  // local nanoseconds into (days-since-epoch, time-of-day-ns) via
  // Int128 division. Days fit in int64 (< 10^8 per the spec range);
  // time-of-day fits in int64 (< 10^14). After splitting we use the
  // Fliegel-Van Flandern helper to get (year, month, day).
  const Int128 ns_per_day(static_cast<int64_t>(kNsPerDay));
  Int128 local_ns = instant.epoch_nanoseconds + Int128(offset_.Nanoseconds());

  // Floor-divide local_ns by ns_per_day so negative epochs (pre-1970)
  // map to the calendar-correct day boundary. C++ '/' truncates
  // toward zero; adjust when the remainder is non-zero AND signs of
  // dividend/divisor disagree.
  Int128 days = local_ns / ns_per_day;
  Int128 rem = local_ns % ns_per_day;
  if (rem != Int128(0) && rem < Int128(0)) {
    days = days - Int128(1);
    rem = rem + ns_per_day;
  }

  const int64_t epoch_days = days.ToInt64();
  const int64_t tod_ns = rem.ToInt64();

  IsoDateTime out{};
  YmdFromEpochDays(epoch_days, &out.date.year, &out.date.month,
                   &out.date.day);
  // Split tod_ns into HH:MM:SS.fff_uuu_nnn.
  out.time.hour = static_cast<uint8_t>(tod_ns / kNsPerHour);
  int64_t r = tod_ns % kNsPerHour;
  out.time.minute = static_cast<uint8_t>(r / kNsPerMinute);
  r %= kNsPerMinute;
  out.time.second = static_cast<uint8_t>(r / kNsPerSecond);
  r %= kNsPerSecond;
  out.time.millisecond = static_cast<uint16_t>(r / kNsPerMillisecond);
  r %= kNsPerMillisecond;
  out.time.microsecond = static_cast<uint16_t>(r / kNsPerMicrosecond);
  out.time.nanosecond = static_cast<uint16_t>(r % kNsPerMicrosecond);
  if (!out.IsValid()) {
    return TemporalError::Range("Resulting IsoDateTime out of range");
  }
  return out;
}

// ── TimeZoneBackend ───────────────────────────────────────────────────

TemporalResult<std::string> TimeZoneBackend::CanonicalizeIdentifier(
    std::string_view /*identifier*/) noexcept {
  return TemporalError::Range(
      "IANA time-zone canonicalization requires a registered backend "
      "(V8's js-temporal layer installs one at boot)");
}

TemporalResult<IsoDateTime> TimeZoneBackend::GetIsoDateTimeFor(
    std::string_view /*iana_id*/, const Instant& /*instant*/) noexcept {
  return TemporalError::Range(
      "IANA time-zone arithmetic requires a registered backend "
      "(V8's js-temporal layer installs one at boot)");
}

namespace {
// Process-static default backend + active-backend pointer. The pointer
// is read on every IANA lookup; we use atomic for thread-safety
// (reads are relaxed because installation is a one-time startup
// action, but the atomic forbids tearing on weakly-ordered platforms).
TimeZoneBackend& DefaultBackend() noexcept {
  static TimeZoneBackend instance;
  return instance;
}
std::atomic<TimeZoneBackend*>& ActiveBackendSlot() noexcept {
  static std::atomic<TimeZoneBackend*> slot{&DefaultBackend()};
  return slot;
}
}  // namespace

TimeZoneBackend& GetTimeZoneBackend() noexcept {
  return *ActiveBackendSlot().load(std::memory_order_acquire);
}

void SetTimeZoneBackend(TimeZoneBackend* backend) noexcept {
  ActiveBackendSlot().store(backend ? backend : &DefaultBackend(),
                              std::memory_order_release);
}

}  // namespace temporal
}  // namespace socketsecurity
}  // namespace node
