// Compat shim: temporal_rs::OwnedRelativeTo. Heap-owning variant of
// RelativeTo — caller transfers ownership of either a PlainDate or a
// ZonedDateTime.

#ifndef TEMPORAL_RS_COMPAT_OWNEDRELATIVETO_HPP_
#define TEMPORAL_RS_COMPAT_OWNEDRELATIVETO_HPP_

#include <cstdint>
#include <memory>

#include "socketsecurity/temporal/relative_to.h"
#include "temporal_rs/PlainDate.hpp"
#include "temporal_rs/RelativeTo.hpp"
#include "temporal_rs/ZonedDateTime.hpp"

namespace temporal_rs {

class OwnedRelativeTo {
 public:
  static std::unique_ptr<OwnedRelativeTo> from_plain_date(
      std::unique_ptr<PlainDate> date) {
    auto* p = new OwnedRelativeTo();
    p->kind_ = RelativeTo::Kind::kPlainDate;
    p->plain_date_ = std::move(date);
    return std::unique_ptr<OwnedRelativeTo>(p);
  }

  static std::unique_ptr<OwnedRelativeTo> from_zoned_date_time(
      std::unique_ptr<ZonedDateTime> zdt) {
    auto* p = new OwnedRelativeTo();
    p->kind_ = RelativeTo::Kind::kZonedDateTime;
    p->zoned_date_time_ = std::move(zdt);
    return std::unique_ptr<OwnedRelativeTo>(p);
  }

  bool is_plain_date() const {
    return kind_ == RelativeTo::Kind::kPlainDate;
  }
  bool is_zoned_date_time() const {
    return kind_ == RelativeTo::Kind::kZonedDateTime;
  }

  // Borrow as a non-owning RelativeTo for use with the spec methods.
  RelativeTo borrow() const {
    if (is_plain_date()) {
      return RelativeTo::FromPlainDate(*plain_date_);
    }
    return RelativeTo::FromZonedDateTime(*zoned_date_time_);
  }

  OwnedRelativeTo(const OwnedRelativeTo&) = delete;
  OwnedRelativeTo(OwnedRelativeTo&&) noexcept = delete;
  OwnedRelativeTo& operator=(const OwnedRelativeTo&) = delete;
  OwnedRelativeTo& operator=(OwnedRelativeTo&&) noexcept = delete;

 private:
  OwnedRelativeTo() = default;

  RelativeTo::Kind kind_ = RelativeTo::Kind::kPlainDate;
  std::unique_ptr<PlainDate> plain_date_;
  std::unique_ptr<ZonedDateTime> zoned_date_time_;
};

}  // namespace temporal_rs

#endif  // TEMPORAL_RS_COMPAT_OWNEDRELATIVETO_HPP_
