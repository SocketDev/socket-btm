// Compat shim: temporal_rs::Calendar. Upstream models this as a
// non-copyable class accessed via Calendar* — diplomat-style heap
// ownership. V8 calls `obj->calendar().kind()` and similar, so we
// need an object with `kind()`. The shim makes Calendar copyable
// (deviating from upstream's deletion list) so per-type accessors
// can return Calendar by value or const-ref. The underlying C++
// port's Calendar is a thin value type (one enum); copying it is
// cheap.

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
  Calendar() = default;
  explicit Calendar(::node::socketsecurity::temporal::Calendar inner)
      : inner_(inner) {}
  Calendar(const Calendar&) = default;
  Calendar(Calendar&&) noexcept = default;
  Calendar& operator=(const Calendar&) = default;
  Calendar& operator=(Calendar&&) noexcept = default;

  static std::unique_ptr<Calendar> create(AnyCalendarKind kind) {
    return std::unique_ptr<Calendar>(new Calendar(
        ::node::socketsecurity::temporal::Calendar(kind.ToInfra())));
  }

  static std::unique_ptr<Calendar> try_new_constrain(AnyCalendarKind kind) {
    return create(kind);
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

  static diplomat::result<std::unique_ptr<Calendar>, TemporalError>
  from_utf8(std::string_view s) {
    return try_from_utf8(s);
  }

  AnyCalendarKind kind() const {
    return AnyCalendarKind::FromInfra(inner_.Kind());
  }

  std::string_view identifier() const {
    return inner_.Identifier();
  }

  bool is_iso() const { return inner_.IsIso(); }

  bool equals(const Calendar& other) const {
    return inner_ == other.inner_;
  }

  std::unique_ptr<Calendar> clone() const {
    return std::unique_ptr<Calendar>(new Calendar(inner_));
  }

  // ── Bridges ────────────────────────────────────────────────────

  const ::node::socketsecurity::temporal::Calendar& ToInfra() const {
    return inner_;
  }

  static std::unique_ptr<Calendar> FromInfra(
      const ::node::socketsecurity::temporal::Calendar& c) {
    return std::unique_ptr<Calendar>(new Calendar(c));
  }

 private:
  ::node::socketsecurity::temporal::Calendar inner_;
};

}  // namespace temporal_rs

#endif  // TEMPORAL_RS_COMPAT_CALENDAR_HPP_
