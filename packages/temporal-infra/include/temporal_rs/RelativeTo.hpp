// Compat shim: temporal_rs::RelativeTo. Borrow-flavored tagged union
// of {PlainDate, ZonedDateTime}, used by Duration arithmetic when
// calendar-aware year/month/week math needs an anchor date.

#ifndef TEMPORAL_RS_COMPAT_RELATIVETO_HPP_
#define TEMPORAL_RS_COMPAT_RELATIVETO_HPP_

#include <cstdint>

#include "socketsecurity/temporal/relative_to.h"
#include "temporal_rs/PlainDate.hpp"
#include "temporal_rs/ZonedDateTime.hpp"

namespace temporal_rs {

// Field names match upstream's diplomat-generated surface — V8 uses
// designated initializer syntax `{.date = ..., .zoned = ...}`. Borrow-
// flavored: non-owning pointers to PlainDate / ZonedDateTime shim
// instances (which themselves wrap heap-owned infra structs).
struct RelativeTo {
  const PlainDate* date = nullptr;
  const ZonedDateTime* zoned = nullptr;

  bool is_plain_date() const { return date != nullptr; }
  bool is_zoned_date_time() const { return zoned != nullptr; }

  static RelativeTo FromPlainDate(const PlainDate& d) {
    return RelativeTo{&d, nullptr};
  }

  static RelativeTo FromZonedDateTime(const ZonedDateTime& z) {
    return RelativeTo{nullptr, &z};
  }

  ::node::socketsecurity::temporal::RelativeTo ToInfra() const {
    if (date != nullptr) {
      return ::node::socketsecurity::temporal::RelativeTo::FromPlainDate(
          date->ToInfra());
    }
    if (zoned != nullptr) {
      return ::node::socketsecurity::temporal::RelativeTo::FromZonedDateTime(
          zoned->ToInfra());
    }
    return ::node::socketsecurity::temporal::RelativeTo::FromPlainDate({});
  }
};

}  // namespace temporal_rs

#endif  // TEMPORAL_RS_COMPAT_RELATIVETO_HPP_
