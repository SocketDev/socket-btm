// 1:1 port of upstream `src/error.rs` at temporal v0.2.3
// (c003cc92325e19b26f8ee2f85e4a47d98cbcc781).
//
// Maps Rust's `TemporalError` (a struct with ErrorKind + message) to a
// plain C++ struct. Idiomatic C++ where Rust idioms don't translate
// cleanly:
//   - Rust's `Display` impl → operator<< / ToString().
//   - Rust's `From<X>` impls for ParseError / icu_calendar errors →
//     static factories (FromParseError, FromCalendarError) — V8's
//     existing JS-Temporal callers already raise their own RangeError
//     / TypeError, so we pass kind through and let the caller convert.

#ifndef SRC_SOCKETSECURITY_TEMPORAL_ERROR_H_
#define SRC_SOCKETSECURITY_TEMPORAL_ERROR_H_

#include <cstdint>
#include <string>
#include <string_view>

namespace node {
namespace socketsecurity {
namespace temporal {

// Mirror of upstream's ErrorKind enum.
enum class ErrorKind : uint8_t {
  kGeneric = 0,  // Spec: "Error" (default)
  kType,         // TypeError
  kRange,        // RangeError
  kSyntax,       // SyntaxError
  kAssert,       // ImplementationError (internal invariant)
};

// Stringify the ErrorKind for display. Matches upstream's Display impl
// exactly (the user-visible name of each error kind).
std::string_view ErrorKindName(ErrorKind k) noexcept;

// Mirror of upstream's TemporalError struct. Plain value type — no
// inheritance from std::exception so it works in noexcept contexts and
// can be returned-by-value through C ABI boundaries.
struct TemporalError {
  ErrorKind kind = ErrorKind::kGeneric;
  // Heap-allocated message; empty if no specific message was provided.
  // Matches upstream's `Cow<'static, str>` cheaply via std::string here.
  std::string message;

  // Static factories matching upstream's TemporalError::generic / type /
  // range / syntax / assert constructors.
  static TemporalError Generic(std::string_view msg = {}) noexcept;
  static TemporalError Type(std::string_view msg = {}) noexcept;
  static TemporalError Range(std::string_view msg = {}) noexcept;
  static TemporalError Syntax(std::string_view msg = {}) noexcept;
  static TemporalError Assert(std::string_view msg = {}) noexcept;
};

// `TemporalResult<T>` upstream is `Result<T, TemporalError>`. C++ has
// no native sum type, but `std::expected` (C++23) is the right shape.
// V8's bytecode requires C++17 minimum; deps/v8 has its own
// `base::expected` shim. For now we use a tiny in-house variant
// patterned after `absl::StatusOr`, since that's what surrounding V8
// code uses (V8 vendors absl).
//
// Lightweight TemporalResult: either a value or an error. Designed to
// be cheap to move and trivially constructible. Methods mirror
// absl::StatusOr's surface to ease later migration.
template <typename T>
class TemporalResult {
 public:
  // Construct from a value (success).
  TemporalResult(T value) noexcept
      : has_value_(true), value_(std::move(value)) {}
  // Construct from an error (failure).
  TemporalResult(TemporalError err) noexcept
      : has_value_(false), error_(std::move(err)) {}

  bool ok() const noexcept { return has_value_; }
  // UB if !ok(). Caller checks ok() first.
  const T& value() const noexcept { return value_; }
  T& value() noexcept { return value_; }
  // UB if ok().
  const TemporalError& error() const noexcept { return error_; }

 private:
  bool has_value_;
  // Discriminated union; only one is alive at a time.
  union {
    T value_;
    TemporalError error_;
  };

 public:
  // Manually managed lifetime — destruct the active arm.
  ~TemporalResult() noexcept {
    if (has_value_) {
      value_.~T();
    } else {
      error_.~TemporalError();
    }
  }
  TemporalResult(const TemporalResult&) = delete;
  TemporalResult& operator=(const TemporalResult&) = delete;
  TemporalResult(TemporalResult&& other) noexcept : has_value_(other.has_value_) {
    if (has_value_) {
      new (&value_) T(std::move(other.value_));
    } else {
      new (&error_) TemporalError(std::move(other.error_));
    }
  }
};

}  // namespace temporal
}  // namespace socketsecurity
}  // namespace node

#endif  // SRC_SOCKETSECURITY_TEMPORAL_ERROR_H_
