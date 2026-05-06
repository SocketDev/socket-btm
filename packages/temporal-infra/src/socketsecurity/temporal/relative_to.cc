// 1:1 port of upstream `src/options/relative_to.rs`.

#include "socketsecurity/temporal/relative_to.h"

namespace node {
namespace socketsecurity {
namespace temporal {

TemporalResult<RelativeTo> RelativeTo::TryFromUtf8(const uint8_t* data,
                                                     size_t length) noexcept {
  // Try ZonedDateTime first (the spec preference: if the input has a
  // [TimeZone] annotation, use it as ZonedDateTime). Today our parser
  // doesn't surface annotations (parse.cc Phase 2), so the
  // ZonedDateTime path matches only UTC-Z input. Fall back to PlainDate.
  auto zdt = ZonedDateTimeFromUtf8(data, length);
  if (zdt.ok()) {
    return RelativeTo::FromZonedDateTime(zdt.value());
  }
  auto pd = PlainDateFromUtf8(data, length);
  if (pd.ok()) {
    return RelativeTo::FromPlainDate(pd.value());
  }
  return TemporalError::Range(
      "RelativeTo string is neither a valid ZonedDateTime nor PlainDate");
}

}  // namespace temporal
}  // namespace socketsecurity
}  // namespace node
