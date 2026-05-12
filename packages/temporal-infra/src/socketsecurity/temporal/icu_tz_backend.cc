// ICU-backed TimeZoneBackend implementation. Routes through
// icu::TimeZone when ICU is available — either V8's V8_INTL_SUPPORT
// (inside V8's gyp scope) or node's NODE_HAVE_I18N_SUPPORT (when this
// TU is compiled into libnode) — rather than re-implementing the
// zoneinfo64 binary parser.

#include "socketsecurity/temporal/icu_tz_backend.h"

#include "socketsecurity/temporal/utils.h"

#if defined(V8_INTL_SUPPORT) || defined(NODE_HAVE_I18N_SUPPORT)
#include "unicode/basictz.h"
#include "unicode/locid.h"
#include "unicode/timezone.h"
#include "unicode/tztrans.h"
#include "unicode/ucal.h"
#include "unicode/unistr.h"
#include "unicode/utypes.h"
#endif

namespace node {
namespace socketsecurity {
namespace temporal {

#if defined(V8_INTL_SUPPORT) || defined(NODE_HAVE_I18N_SUPPORT)

namespace {

// Open an ICU TimeZone for the given identifier; nullptr (well, a
// "bogus" wrapper) signals unknown TZ. Caller owns the returned
// pointer.
std::unique_ptr<icu::TimeZone> OpenIcuTz(std::string_view iana_id) {
  icu::UnicodeString id(iana_id.data(),
                        static_cast<int32_t>(iana_id.size()), US_INV);
  std::unique_ptr<icu::TimeZone> tz(icu::TimeZone::createTimeZone(id));
  if (tz == nullptr) {
    return nullptr;
  }
  // ICU returns a special "Etc/Unknown" timezone instead of nullptr
  // when the identifier doesn't match — detect that.
  icu::UnicodeString returned_id;
  tz->getID(returned_id);
  static const icu::UnicodeString kUnknown("Etc/Unknown", -1, US_INV);
  if (returned_id == kUnknown) {
    return nullptr;
  }
  return tz;
}

}  // namespace

TemporalResult<std::string> IcuTimeZoneBackend::CanonicalizeIdentifier(
    std::string_view identifier) noexcept {
  icu::UnicodeString id(identifier.data(),
                        static_cast<int32_t>(identifier.size()), US_INV);
  icu::UnicodeString canonical;
  UBool is_system_id = false;
  UErrorCode status = U_ZERO_ERROR;
  icu::TimeZone::getCanonicalID(id, canonical, is_system_id, status);
  if (U_FAILURE(status) || !is_system_id) {
    return TemporalError::Range(
        "Unknown IANA timezone identifier");
  }
  std::string out;
  canonical.toUTF8String(out);
  return out;
}

TemporalResult<IsoDateTime> IcuTimeZoneBackend::GetIsoDateTimeFor(
    std::string_view iana_id, const Instant& instant) noexcept {
  auto tz = OpenIcuTz(iana_id);
  if (tz == nullptr) {
    return TemporalError::Range(
        "Unknown IANA timezone identifier");
  }
  // ICU operates in milliseconds; floor-divide nanoseconds → ms.
  // Instant epoch_nanoseconds is int128 but for ICU we only need
  // i64 milliseconds (ICU's domain is ±~292 million years from
  // 1970; Instant's spec range is ±275760 years, so the cast is
  // safe inside the spec range).
  const Int128 kNsPerMs(static_cast<int64_t>(kNsPerMillisecond));
  const int64_t epoch_ms =
      instant.epoch_nanoseconds.FloorDiv(kNsPerMs).ToInt64();
  UErrorCode status = U_ZERO_ERROR;
  int32_t raw_offset_ms = 0;
  int32_t dst_offset_ms = 0;
  tz->getOffset(static_cast<UDate>(epoch_ms), /*local=*/false, raw_offset_ms,
                dst_offset_ms, status);
  if (U_FAILURE(status)) {
    return TemporalError::Range(
        "ICU TimeZone::getOffset failed");
  }
  const int64_t total_offset_ns =
      (static_cast<int64_t>(raw_offset_ms) +
       static_cast<int64_t>(dst_offset_ms)) *
      kNsPerMillisecond;
  // Add offset to epoch_ns to get local wall-clock ns, then split
  // into (days-since-epoch, time-of-day-ns).
  const Int128 local_ns =
      instant.epoch_nanoseconds + Int128(total_offset_ns);
  const Int128 ns_per_day(static_cast<int64_t>(kNsPerDay));
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
    return TemporalError::Range(
        "Resulting IsoDateTime out of range");
  }
  return out;
}

TemporalResult<Int128> IcuTimeZoneBackend::GetEpochNanosecondsFor(
    std::string_view iana_id, const IsoDateTime& datetime,
    Disambiguation disambiguation) noexcept {
  auto tz = OpenIcuTz(iana_id);
  if (tz == nullptr) {
    return TemporalError::Range(
        "Unknown IANA timezone identifier");
  }
  // Compute the "as-UTC" epoch ms from the wall-clock datetime —
  // this is what ICU's getOffsetFromLocal expects.
  const int64_t epoch_days = EpochDaysFromGregorianDate(
      datetime.date.year, datetime.date.month, datetime.date.day);
  const int64_t tod_ns =
      static_cast<int64_t>(datetime.time.hour) * kNsPerHour +
      static_cast<int64_t>(datetime.time.minute) * kNsPerMinute +
      static_cast<int64_t>(datetime.time.second) * kNsPerSecond +
      static_cast<int64_t>(datetime.time.millisecond) * kNsPerMillisecond +
      static_cast<int64_t>(datetime.time.microsecond) * kNsPerMicrosecond +
      static_cast<int64_t>(datetime.time.nanosecond);
  const int64_t epoch_ms = epoch_days * kMsPerDay + tod_ns / kNsPerMillisecond;
  // icu::BasicTimeZone::getOffsetFromLocal takes "non-existing time"
  // and "duplicated time" options. Map our Disambiguation:
  //   kCompatible — fall-back picks former (earlier); spring-forward
  //                  uses the post-transition offset.
  //   kEarlier    — both ambiguous cases pick the earlier instant.
  //   kLater      — both pick the later instant.
  //   kReject     — return Range when ambiguous or gap.
  // SimpleTimeZone + OlsonTimeZone both inherit from BasicTimeZone, and
  // createTimeZone returns one of those for any non-bogus IANA ID (we
  // checked Etc/Unknown above). Using static_cast lets this TU compile
  // under -fno-rtti (libnode) while keeping the same runtime behavior.
  auto* basic_tz = static_cast<icu::BasicTimeZone*>(tz.get());
  // Use the public UTimeZoneLocalOption API from unicode/ucal.h rather
  // than BasicTimeZone's anonymous internal enum, which is hidden when
  // U_HIDE_INTERNAL_API is set (libnode's ICU build).
  UTimeZoneLocalOption nonexisting = UCAL_TZ_LOCAL_FORMER;
  UTimeZoneLocalOption duplicated = UCAL_TZ_LOCAL_FORMER;
  bool reject_on_ambiguity = false;
  switch (disambiguation) {
    case Disambiguation::kCompatible:
      nonexisting = UCAL_TZ_LOCAL_FORMER;
      duplicated = UCAL_TZ_LOCAL_FORMER;
      break;
    case Disambiguation::kEarlier:
      nonexisting = UCAL_TZ_LOCAL_FORMER;
      duplicated = UCAL_TZ_LOCAL_FORMER;
      break;
    case Disambiguation::kLater:
      nonexisting = UCAL_TZ_LOCAL_LATTER;
      duplicated = UCAL_TZ_LOCAL_LATTER;
      break;
    case Disambiguation::kReject:
      reject_on_ambiguity = true;
      break;
  }
  UErrorCode status = U_ZERO_ERROR;
  int32_t raw_offset_ms = 0;
  int32_t dst_offset_ms = 0;
  basic_tz->getOffsetFromLocal(static_cast<UDate>(epoch_ms), nonexisting,
                               duplicated, raw_offset_ms, dst_offset_ms,
                               status);
  if (U_FAILURE(status)) {
    return TemporalError::Range(
        "ICU TimeZone::getOffsetFromLocal failed");
  }
  if (reject_on_ambiguity) {
    // For reject mode, query both kFormer + kLatter; if they differ
    // the wall-clock is either ambiguous (overlap) or invalid (gap)
    // — both rejected per Disambiguation::kReject.
    UErrorCode s1 = U_ZERO_ERROR;
    UErrorCode s2 = U_ZERO_ERROR;
    int32_t f_raw = 0, f_dst = 0, l_raw = 0, l_dst = 0;
    basic_tz->getOffsetFromLocal(static_cast<UDate>(epoch_ms),
                                 icu::BasicTimeZone::kFormer,
                                 icu::BasicTimeZone::kFormer, f_raw, f_dst,
                                 s1);
    basic_tz->getOffsetFromLocal(static_cast<UDate>(epoch_ms),
                                 icu::BasicTimeZone::kLatter,
                                 icu::BasicTimeZone::kLatter, l_raw, l_dst,
                                 s2);
    if (U_FAILURE(s1) || U_FAILURE(s2) ||
        (f_raw + f_dst) != (l_raw + l_dst)) {
      return TemporalError::Range(
          "Wall-clock falls in DST gap or overlap (disambiguation='reject')");
    }
  }
  const int64_t total_offset_ns =
      (static_cast<int64_t>(raw_offset_ms) +
       static_cast<int64_t>(dst_offset_ms)) *
      kNsPerMillisecond;
  // epoch_ns = local_as_utc_ns - offset_ns.
  const Int128 utc_ns =
      Int128(epoch_days) * Int128(static_cast<int64_t>(kNsPerDay)) +
      Int128(tod_ns);
  const Int128 ns = utc_ns - Int128(total_offset_ns);
  Instant probe{};
  probe.epoch_nanoseconds = ns;
  if (!probe.IsValid()) {
    return TemporalError::Range(
        "Resolved epoch nanoseconds outside valid Instant range");
  }
  return ns;
}

// 1:1 from upstream `provider::get_time_zone_transition`. The ICU
// API is `BasicTimeZone::getNextTransition(base, inclusive, result)`
// / `getPreviousTransition(base, inclusive, result)`; both return
// `true` when a transition exists in the requested direction and
// fill `result` with a UDate (ms since epoch). We translate that
// back to int128 epoch_nanoseconds.
TemporalResult<std::optional<Int128>> IcuTimeZoneBackend::GetTransition(
    std::string_view iana_id, const Int128& from_epoch_ns,
    TransitionDirection direction) noexcept {
  icu::UnicodeString id =
      icu::UnicodeString::fromUTF8(icu::StringPiece(iana_id.data(),
                                                     iana_id.size()));
  std::unique_ptr<icu::TimeZone> tz(icu::TimeZone::createTimeZone(id));
  icu::UnicodeString actual_id;
  tz->getID(actual_id);
  if (actual_id == UNICODE_STRING_SIMPLE("Etc/Unknown")) {
    return TemporalError::Range(
        "ICU does not recognize the requested IANA identifier");
  }
  // See static_cast rationale in ResolveOffsetFromLocal above. ICU's
  // createTimeZone returns SimpleTimeZone or OlsonTimeZone for any
  // non-bogus IANA id, both of which inherit from BasicTimeZone.
  auto* basic_tz = static_cast<icu::BasicTimeZone*>(tz.get());
  using NativeInt128 = decltype(from_epoch_ns.value);
  const NativeInt128 from_ns = from_epoch_ns.value;
  const NativeInt128 ns_per_ms{1'000'000};
  // Floor division for negative values (UDate is double ms).
  NativeInt128 from_ms;
  if (from_ns >= 0) {
    from_ms = from_ns / ns_per_ms;
  } else {
    NativeInt128 q = from_ns / ns_per_ms;
    NativeInt128 r = from_ns % ns_per_ms;
    from_ms = (r == 0) ? q : q - 1;
  }
  const UDate base_ms = static_cast<UDate>(static_cast<double>(from_ms));
  icu::TimeZoneTransition tzt;
  UBool found = false;
  if (direction == TransitionDirection::kNext) {
    found = basic_tz->getNextTransition(base_ms, /*inclusive=*/false, tzt);
  } else {
    found =
        basic_tz->getPreviousTransition(base_ms, /*inclusive=*/false, tzt);
  }
  if (!found) {
    return std::optional<Int128>(std::nullopt);
  }
  const UDate result_ms = tzt.getTime();
  const int64_t result_ms_i = static_cast<int64_t>(result_ms);
  Int128 out;
  out.value = static_cast<NativeInt128>(result_ms_i) * ns_per_ms;
  // Validate Instant range so the caller doesn't materialize an
  // out-of-bounds ZDT (upstream's check_validity() guard).
  Instant probe{};
  probe.epoch_nanoseconds = out;
  if (!probe.IsValid()) {
    return std::optional<Int128>(std::nullopt);
  }
  return std::optional<Int128>(out);
}

void InstallIcuTimeZoneBackend() noexcept {
  // Process-static instance — TimeZoneBackend's SetTimeZoneBackend
  // takes a non-owning pointer.
  static IcuTimeZoneBackend instance;
  SetTimeZoneBackend(&instance);
}

// Auto-install trampoline called from time_zone.cc's
// GetTimeZoneBackend(). The strong symbol lives here when ICU is
// linked; when V8 is built without intl support the fallback below
// is used (no-op).
void InstallIcuTimeZoneBackendIfAvailable() noexcept {
  InstallIcuTimeZoneBackend();
}

#else  // No ICU available — stub everything.

TemporalResult<std::string> IcuTimeZoneBackend::CanonicalizeIdentifier(
    std::string_view /*identifier*/) noexcept {
  return TemporalError::Range(
      "ICU TimeZone backend requires V8_INTL_SUPPORT to be enabled");
}

TemporalResult<IsoDateTime> IcuTimeZoneBackend::GetIsoDateTimeFor(
    std::string_view /*iana_id*/, const Instant& /*instant*/) noexcept {
  return TemporalError::Range(
      "ICU TimeZone backend requires V8_INTL_SUPPORT to be enabled");
}

TemporalResult<Int128> IcuTimeZoneBackend::GetEpochNanosecondsFor(
    std::string_view /*iana_id*/, const IsoDateTime& /*datetime*/,
    Disambiguation /*disambiguation*/) noexcept {
  return TemporalError::Range(
      "ICU TimeZone backend requires V8_INTL_SUPPORT to be enabled");
}

TemporalResult<std::optional<Int128>> IcuTimeZoneBackend::GetTransition(
    std::string_view /*iana_id*/, const Int128& /*from_epoch_ns*/,
    TransitionDirection /*direction*/) noexcept {
  return TemporalError::Range(
      "ICU TimeZone backend requires V8_INTL_SUPPORT to be enabled");
}

void InstallIcuTimeZoneBackend() noexcept {
  // No-op when ICU isn't linked. IANA queries fall back to the
  // default-reject backend; only offset-only TZs work.
}

void InstallIcuTimeZoneBackendIfAvailable() noexcept {
  // No-op in non-intl builds — trampoline called by
  // time_zone.cc:GetTimeZoneBackend() once at first use.
}

#endif  // V8_INTL_SUPPORT

}  // namespace temporal
}  // namespace socketsecurity
}  // namespace node
