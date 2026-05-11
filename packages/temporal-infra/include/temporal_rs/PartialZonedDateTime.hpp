// Compat shim: temporal_rs::PartialZonedDateTime. Optional-fields
// struct used by ZonedDateTime::from_partial / with. Field names and
// types mirror upstream's diplomat-generated layout so V8's designated
// initializers (`.date = ..., .time = ..., .offset = std::nullopt,
// .timezone = std::nullopt`) compile.
//
// `offset` was previously `std::optional<std::string_view>` to mirror
// upstream's diplomat lifetime parameter. V8's call site is
// `record.offset = offset.value()` where `offset` is
// `std::optional<std::string>` — that assignment implicitly converts
// to a view into V8's temporary, which is then used after the
// statement completes. Replaced with `std::optional<std::string>` to
// take ownership, eliminating the dangling-view risk (same shape as
// the TemporalError fix in 9aea3e3c).

#ifndef TEMPORAL_RS_COMPAT_PARTIALZONEDDATETIME_HPP_
#define TEMPORAL_RS_COMPAT_PARTIALZONEDDATETIME_HPP_

#include <optional>
#include <string>

#include "temporal_rs/PartialDate.hpp"
#include "temporal_rs/PartialTime.hpp"
#include "temporal_rs/TimeZone.hpp"

namespace temporal_rs {

struct PartialZonedDateTime {
  PartialDate date;
  PartialTime time;
  std::optional<std::string> offset;
  std::optional<TimeZone> timezone;

  bool is_empty() const {
    return date.is_empty() && time.is_empty() && !offset.has_value() &&
           !timezone.has_value();
  }
};

}  // namespace temporal_rs

#endif  // TEMPORAL_RS_COMPAT_PARTIALZONEDDATETIME_HPP_
