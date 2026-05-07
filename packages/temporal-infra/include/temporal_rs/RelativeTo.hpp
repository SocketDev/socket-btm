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

// Borrow-flavored: holds non-owning pointers to PlainDate / ZonedDateTime
// shim instances (which themselves wrap heap-owned infra structs).
struct RelativeTo {
  enum class Kind : uint8_t { kPlainDate, kZonedDateTime };

  Kind kind = Kind::kPlainDate;
  const PlainDate* plain_date = nullptr;
  const ZonedDateTime* zoned_date_time = nullptr;

  bool is_plain_date() const { return kind == Kind::kPlainDate; }
  bool is_zoned_date_time() const { return kind == Kind::kZonedDateTime; }

  static RelativeTo FromPlainDate(const PlainDate& d) {
    RelativeTo r;
    r.kind = Kind::kPlainDate;
    r.plain_date = &d;
    return r;
  }

  static RelativeTo FromZonedDateTime(const ZonedDateTime& z) {
    RelativeTo r;
    r.kind = Kind::kZonedDateTime;
    r.zoned_date_time = &z;
    return r;
  }

  ::node::socketsecurity::temporal::RelativeTo ToInfra() const {
    if (kind == Kind::kPlainDate && plain_date != nullptr) {
      return ::node::socketsecurity::temporal::RelativeTo::FromPlainDate(
          plain_date->ToInfra());
    }
    if (kind == Kind::kZonedDateTime && zoned_date_time != nullptr) {
      return ::node::socketsecurity::temporal::RelativeTo::FromZonedDateTime(
          zoned_date_time->ToInfra());
    }
    return ::node::socketsecurity::temporal::RelativeTo::FromPlainDate({});
  }
};

}  // namespace temporal_rs

#endif  // TEMPORAL_RS_COMPAT_RELATIVETO_HPP_
