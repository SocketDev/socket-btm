// 1:1 port of upstream `src/options/relative_to.rs`.
//
// Lock-step from Rust: options/relative_to.rs

#include "socketsecurity/temporal/relative_to.h"

namespace node {
namespace socketsecurity {
namespace temporal {

TemporalResult<RelativeTo> RelativeTo::TryFromUtf8(const uint8_t* data,
                                                     size_t length) noexcept {
  // Spec preference: input with a [TimeZone] annotation must resolve as
  // ZonedDateTime; otherwise PlainDate. ZonedDateTimeFromUtf8 enforces
  // the [TimeZone] requirement and the offset/disambiguation rules,
  // which is what we want — try it first, then fall back.
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
