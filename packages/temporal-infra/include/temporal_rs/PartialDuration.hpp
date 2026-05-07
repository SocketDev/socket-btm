// Compat shim: temporal_rs::PartialDuration. Optional-fields struct
// used by Duration::from_partial_duration / Duration::with.

#ifndef TEMPORAL_RS_COMPAT_PARTIALDURATION_HPP_
#define TEMPORAL_RS_COMPAT_PARTIALDURATION_HPP_

#include <optional>

namespace temporal_rs {

struct PartialDuration {
  std::optional<double> years;
  std::optional<double> months;
  std::optional<double> weeks;
  std::optional<double> days;
  std::optional<double> hours;
  std::optional<double> minutes;
  std::optional<double> seconds;
  std::optional<double> milliseconds;
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
