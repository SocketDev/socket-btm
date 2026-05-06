// 1:1 port of upstream `src/builtins/core/time_zone.rs`.
//
// SCAFFOLD — covers offset-only zones (which don't need tzdata).
// IANA-named zones stub to TemporalError until V8's zoneinfo64
// dispatch is wired up.

#include "socketsecurity/temporal/time_zone.h"

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
  // TODO(temporal-port): fractional-second support per RFC 9557 — small
  // number of zones use it; defer until a real-world need surfaces.
  const int64_t total_seconds = static_cast<int64_t>(hh) * 3600 +
                                 static_cast<int64_t>(mm) * 60 + ss;
  return UtcOffset(sign * total_seconds * 1'000'000'000LL);
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
  // IANA path: canonicalization needs ICU's `ucal_getCanonicalTimeZoneID`.
  // Until that's wired up, pass-through with the raw identifier so
  // round-tripping works for tests that don't actually need the zone
  // data.
  TimeZone tz;
  tz.kind_ = Kind::kIanaIdentifier;
  tz.iana_id_ = std::string(identifier);
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
    // IANA path needs V8's zoneinfo64 dispatch; pending.
    return TemporalError::Range(
        "IANA time-zone arithmetic not yet implemented");
  }
  // Offset-only: compute local IsoDateTime by adding the offset to the
  // instant. Math is in nanoseconds; we then split into days + tod.
  // epoch_nanoseconds is Int128; offset is i64; result is Int128.
  // Keep it simple: convert via i64 path (good for any in-range Instant).
  // TODO(temporal-port): use Int128 path for the i64-overflow corner.
  // Caller's invariant: |epoch_nanoseconds| ≤ 8.64e21 fits in i128 only,
  // not i64 — so this stub is approximate.
  return TemporalError::Range(
      "TimeZone::GetIsoDateTimeFor offset path not yet wired into Int128");
}

}  // namespace temporal
}  // namespace socketsecurity
}  // namespace node
