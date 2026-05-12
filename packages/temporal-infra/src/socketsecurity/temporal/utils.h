// 1:1 port of upstream `src/utils.rs` at temporal v0.2.3.
//
// Utility constants and date equations. Upstream re-exports a few
// helpers from `timezone_provider::utils`; we inline the minimal set
// our other ports need (epoch_days_from_gregorian_date, etc.) here
// since `timezone_provider` isn't ported.

#ifndef SRC_SOCKETSECURITY_TEMPORAL_UTILS_H_
#define SRC_SOCKETSECURITY_TEMPORAL_UTILS_H_

#include <cstdint>

// ICU availability gate for the temporal-infra port. The two
// underlying defines come from different gyp scopes:
//   - V8_INTL_SUPPORT is set inside V8's gyp targets when
//     v8_enable_i18n_support==1 (V8 self-compiled with ICU).
//   - NODE_HAVE_I18N_SUPPORT is set on libnode's gyp target when
//     v8_enable_i18n_support==1 (libnode compiles with ICU includes).
// Either signal means ICU headers + symbols are reachable, so the
// real backend branch should compile. We mirror this check in every
// ICU-dispatch TU; if you find yourself writing
// `#if defined(V8_INTL_SUPPORT) || defined(NODE_HAVE_I18N_SUPPORT)`
// somewhere, use TEMPORAL_INFRA_HAS_ICU instead.
#if defined(V8_INTL_SUPPORT) || defined(NODE_HAVE_I18N_SUPPORT)
#define TEMPORAL_INFRA_HAS_ICU 1
#endif

namespace node {
namespace socketsecurity {
namespace temporal {

// Time-unit constants. Upstream: `MS_PER_HOUR`, `MS_PER_MINUTE`. Our
// callers also need MS/SECOND/DAY for arithmetic; including those for
// completeness.
constexpr int64_t kMsPerSecond = 1000;
constexpr int64_t kMsPerMinute = 60'000;
constexpr int64_t kMsPerHour = 3'600'000;
constexpr int64_t kMsPerDay = 86'400'000;

constexpr int64_t kNsPerMicrosecond = 1000;
constexpr int64_t kNsPerMillisecond = 1'000'000;
constexpr int64_t kNsPerSecond = 1'000'000'000;
constexpr int64_t kNsPerMinute = 60LL * kNsPerSecond;
constexpr int64_t kNsPerHour = 60LL * kNsPerMinute;
constexpr int64_t kNsPerDay = 24LL * kNsPerHour;

// Convert a Gregorian (year, month, day) into days since the Unix epoch
// (1970-01-01). Negative for dates before 1970. Mirrors upstream's
// `epoch_days_from_gregorian_date`. Implemented via Fliegel-Van
// Flandern JDN math (also used in iso.cc; consolidated here).
int64_t EpochDaysFromGregorianDate(int32_t year, uint8_t month,
                                   uint8_t day) noexcept;

// Convert epoch days back to (year, month, day). Inverse of
// EpochDaysFromGregorianDate.
void YmdFromEpochDays(int64_t epoch_days, int32_t* year, uint8_t* month,
                      uint8_t* day) noexcept;

}  // namespace temporal
}  // namespace socketsecurity
}  // namespace node

#endif  // SRC_SOCKETSECURITY_TEMPORAL_UTILS_H_
