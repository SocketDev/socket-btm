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
  // Upstream uses `optional<string_view>` here as a public field
  // (V8 reads `err.msg.has_value()` and `err.msg.value()`). Our
  // ownership story is different (no FFI boundary, we own the
  // string), but for V8 source-compat we must expose `msg` as a
  // public optional<string_view> field. The backing storage lives
  // in `msg_storage`; FromInfra() constructs the view-into-storage.
  std::string msg_storage;
  std::optional<std::string_view> msg;

  // Default ctor.
  TemporalError() = default;

  // Construct with kind + storage. msg is set to a view of storage
  // (or nullopt when storage is empty).
  TemporalError(ErrorKind k, std::string storage)
      : kind(k), msg_storage(std::move(storage)) {
    if (!msg_storage.empty()) {
      msg = std::string_view(msg_storage);
    }
  }

  // Bridge from temporal-infra's TemporalError.
  static TemporalError FromInfra(
      const ::node::socketsecurity::temporal::TemporalError& err) {
    return TemporalError(ErrorKind::FromInfra(err.kind), err.message);
  }
};

}  // namespace temporal_rs

#endif  // TEMPORAL_RS_COMPAT_TEMPORALERROR_HPP_
