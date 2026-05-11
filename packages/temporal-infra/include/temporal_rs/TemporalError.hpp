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
  // in `msg_storage`; the copy/move ctors below rebind `msg` to
  // point at THIS instance's storage so the view is never dangling.
  //
  // The previous shape used implicit defaulted ctors, which copied
  // `msg` (string_view) bitwise from the source — leaving it pointing
  // at the SOURCE's storage. When V8 received the error by value
  // (TemporalResult::err().value()), the source had already destructed,
  // so `err.msg.value()` was a dangling view and printed garbage
  // ("@UZ"-style undefined-behavior output) instead of the real
  // message. Custom copy/move ctors + assignment ops rebind `msg`
  // onto `this->msg_storage` after the move, eliminating the
  // dangling-pointer footgun.
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

  // Rebinding copy: copy storage, then point `msg` at OUR storage.
  TemporalError(const TemporalError& other)
      : kind(other.kind), msg_storage(other.msg_storage) {
    if (!msg_storage.empty()) {
      msg = std::string_view(msg_storage);
    }
  }

  // Rebinding move: move storage, then point `msg` at OUR storage.
  // The source's `msg` is left empty (it points at moved-from storage,
  // which std::string guarantees is left in a valid empty-or-similar
  // state — but we clear `msg` explicitly to avoid surprise).
  TemporalError(TemporalError&& other) noexcept
      : kind(other.kind), msg_storage(std::move(other.msg_storage)) {
    if (!msg_storage.empty()) {
      msg = std::string_view(msg_storage);
    }
    other.msg.reset();
  }

  TemporalError& operator=(const TemporalError& other) {
    if (this != &other) {
      kind = other.kind;
      msg_storage = other.msg_storage;
      msg = msg_storage.empty()
                ? std::optional<std::string_view>{}
                : std::optional<std::string_view>{std::string_view(msg_storage)};
    }
    return *this;
  }

  TemporalError& operator=(TemporalError&& other) noexcept {
    if (this != &other) {
      kind = other.kind;
      msg_storage = std::move(other.msg_storage);
      msg = msg_storage.empty()
                ? std::optional<std::string_view>{}
                : std::optional<std::string_view>{std::string_view(msg_storage)};
      other.msg.reset();
    }
    return *this;
  }

  // Bridge from temporal-infra's TemporalError.
  static TemporalError FromInfra(
      const ::node::socketsecurity::temporal::TemporalError& err) {
    return TemporalError(ErrorKind::FromInfra(err.kind), err.message);
  }
};

}  // namespace temporal_rs

#endif  // TEMPORAL_RS_COMPAT_TEMPORALERROR_HPP_
