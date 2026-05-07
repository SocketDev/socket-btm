// Compat shim: temporal_rs::TemporalError → maps onto our
// node::socketsecurity::temporal::TemporalError. Layout matches
// upstream's exposed shape (`{kind, msg}`) so V8 code that reads
// `error.kind` / `error.msg` directly works without changes.

#ifndef TEMPORAL_RS_COMPAT_TEMPORALERROR_HPP_
#define TEMPORAL_RS_COMPAT_TEMPORALERROR_HPP_

#include <optional>
#include <string>
#include <string_view>

#include "socketsecurity/temporal/error.h"
#include "temporal_rs/ErrorKind.hpp"

namespace temporal_rs {

struct TemporalError {
  ErrorKind kind;
  // Upstream uses `optional<string_view>` here, holding a borrow into
  // the underlying Rust string. We own the string ourselves (no FFI
  // boundary) so a `std::string` is the natural fit; a
  // `std::optional<std::string_view>` accessor is provided for
  // V8 call-site source compat.
  std::string msg_storage;

  std::optional<std::string_view> msg() const {
    if (msg_storage.empty()) {
      return std::nullopt;
    }
    return std::string_view(msg_storage);
  }

  // Bridge from temporal-infra's TemporalError.
  static TemporalError FromInfra(
      const ::node::socketsecurity::temporal::TemporalError& err) {
    return TemporalError{ErrorKind::FromInfra(err.kind), err.message};
  }
};

}  // namespace temporal_rs

#endif  // TEMPORAL_RS_COMPAT_TEMPORALERROR_HPP_
