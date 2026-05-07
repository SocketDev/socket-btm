// Compat shim: temporal_rs::PartialDuration. Optional-fields struct
// used by Duration::from_partial_duration / Duration::with.

#ifndef TEMPORAL_RS_COMPAT_PARTIALDURATION_HPP_
#define TEMPORAL_RS_COMPAT_PARTIALDURATION_HPP_

#include <cstdint>
#include <optional>

namespace temporal_rs {

struct PartialDuration {
  // Match upstream's diplomat surface: integer fields for time units
  // that fit exactly in int64, double only for sub-millisecond
  // precision where IEEE-754 fractional bits matter.
  std::optional<int64_t> years;
  std::optional<int64_t> months;
  std::optional<int64_t> weeks;
  std::optional<int64_t> days;
  std::optional<int64_t> hours;
  std::optional<int64_t> minutes;
  std::optional<int64_t> seconds;
  std::optional<int64_t> milliseconds;
  std::optional<double> microseconds;
  std::optional<double> nanoseconds;

  // True iff every field is std::nullopt — upstream's
  // `PartialDuration::is_empty`. Used by V8 to reject `with({})`.
  bool is_empty() const {
    return !years && !months && !weeks && !days && !hours && !minutes &&
           !seconds && !milliseconds && !microseconds && !nanoseconds;
  }
};

}  // namespace temporal_rs

#endif  // TEMPORAL_RS_COMPAT_PARTIALDURATION_HPP_
