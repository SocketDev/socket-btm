// 1:1 port of upstream `src/options/relative_to.rs` at
// temporal v0.2.3 (c003cc92325e19b26f8ee2f85e4a47d98cbcc781).
//
// `RelativeTo` is a tagged union of PlainDate or ZonedDateTime. Used
// by Duration arithmetic when calendar-aware year/month/week math
// needs an anchor date.

#ifndef SRC_SOCKETSECURITY_TEMPORAL_RELATIVE_TO_H_
#define SRC_SOCKETSECURITY_TEMPORAL_RELATIVE_TO_H_

#include <cstddef>
#include <cstdint>

#include "socketsecurity/temporal/error.h"
#include "socketsecurity/temporal/plain_date.h"
#include "socketsecurity/temporal/temporal.h"
#include "socketsecurity/temporal/zoned_date_time.h"

namespace node {
namespace socketsecurity {
namespace temporal {

// Mirror of upstream's `RelativeTo` enum.
class RelativeTo {
 public:
  enum class Kind : uint8_t { kPlainDate, kZonedDateTime };

  static RelativeTo FromPlainDate(PlainDate date) noexcept {
    RelativeTo r;
    r.kind_ = Kind::kPlainDate;
    r.date_ = date;
    return r;
  }
  static RelativeTo FromZonedDateTime(ZonedDateTime zdt) noexcept {
    RelativeTo r;
    r.kind_ = Kind::kZonedDateTime;
    r.zdt_ = zdt;
    return r;
  }

  Kind kind() const noexcept { return kind_; }
  bool IsPlainDate() const noexcept { return kind_ == Kind::kPlainDate; }
  bool IsZonedDateTime() const noexcept {
    return kind_ == Kind::kZonedDateTime;
  }
  // UB if !IsPlainDate() / !IsZonedDateTime().
  const PlainDate& AsPlainDate() const noexcept { return date_; }
  const ZonedDateTime& AsZonedDateTime() const noexcept { return zdt_; }

  // Mirror of upstream's `try_from_str_with_provider`. Tries
  // ZonedDateTime first; falls back to PlainDate.
  static TemporalResult<RelativeTo> TryFromUtf8(const uint8_t* data,
                                                  size_t length) noexcept;

 private:
  RelativeTo() = default;
  Kind kind_ = Kind::kPlainDate;
  PlainDate date_{};
  ZonedDateTime zdt_{};
};

}  // namespace temporal
}  // namespace socketsecurity
}  // namespace node

#endif  // SRC_SOCKETSECURITY_TEMPORAL_RELATIVE_TO_H_
