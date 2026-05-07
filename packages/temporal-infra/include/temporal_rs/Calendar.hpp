// Compat shim: temporal_rs::Calendar — heap-owned wrapper around
// node::socketsecurity::temporal::Calendar. Diplomat conventions:
// non-copyable / non-movable, factories return result<unique_ptr,...>.

#ifndef TEMPORAL_RS_COMPAT_CALENDAR_HPP_
#define TEMPORAL_RS_COMPAT_CALENDAR_HPP_

#include <cstdint>
#include <memory>
#include <string>
#include <string_view>

#include "socketsecurity/temporal/calendar.h"
#include "socketsecurity/temporal/error.h"
#include "socketsecurity/temporal/temporal.h"
#include "temporal_rs/AnyCalendarKind.hpp"
#include "temporal_rs/TemporalError.hpp"
#include "temporal_rs/diplomat_runtime.hpp"

namespace temporal_rs {

class Calendar {
 public:
  static std::unique_ptr<Calendar> create(AnyCalendarKind kind) {
    return std::unique_ptr<Calendar>(new Calendar(
        ::node::socketsecurity::temporal::Calendar(kind.ToInfra())));
  }

  static std::unique_ptr<Calendar> create_iso() {
    return std::unique_ptr<Calendar>(new Calendar(
        ::node::socketsecurity::temporal::Calendar::Iso()));
  }

  static diplomat::result<std::unique_ptr<Calendar>, TemporalError>
  try_from_utf8(std::string_view s) {
    auto r = ::node::socketsecurity::temporal::Calendar::TryFromUtf8(
        reinterpret_cast<const uint8_t*>(s.data()), s.size());
    if (!r.ok()) {
      return diplomat::Err<TemporalError>(
          TemporalError::FromInfra(r.error()));
    }
    return diplomat::Ok<std::unique_ptr<Calendar>>(
        std::unique_ptr<Calendar>(new Calendar(r.value())));
  }

  AnyCalendarKind kind() const {
    return AnyCalendarKind::FromInfra(inner_.Kind());
  }

  std::string identifier() const {
    return std::string(inner_.Identifier());
  }

  bool is_iso() const { return inner_.IsIso(); }

  bool equals(const Calendar& other) const {
    return inner_ == other.inner_;
  }

  std::unique_ptr<Calendar> clone() const {
    return std::unique_ptr<Calendar>(new Calendar(inner_));
  }

  const ::node::socketsecurity::temporal::Calendar& ToInfra() const {
    return inner_;
  }

  static std::unique_ptr<Calendar> FromInfra(
      const ::node::socketsecurity::temporal::Calendar& c) {
    return std::unique_ptr<Calendar>(new Calendar(c));
  }

  Calendar() = delete;
  Calendar(const Calendar&) = delete;
  Calendar(Calendar&&) noexcept = delete;
  Calendar& operator=(const Calendar&) = delete;
  Calendar& operator=(Calendar&&) noexcept = delete;

 private:
  explicit Calendar(::node::socketsecurity::temporal::Calendar inner)
      : inner_(inner) {}

  ::node::socketsecurity::temporal::Calendar inner_;
};

}  // namespace temporal_rs

#endif  // TEMPORAL_RS_COMPAT_CALENDAR_HPP_
