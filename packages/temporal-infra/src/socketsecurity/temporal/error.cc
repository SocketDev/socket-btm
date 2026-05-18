// 1:1 port of upstream `src/error.rs`.
//
// Lock-step from Rust: error.rs

#include "socketsecurity/temporal/error.h"

namespace node {
namespace socketsecurity {
namespace temporal {

std::string_view ErrorKindName(ErrorKind k) noexcept {
  // Mirror upstream's Display impl. Order matters per the enum
  // definition; switch is exhaustive on the kind.
  switch (k) {
    case ErrorKind::kGeneric:
      return "Error";
    case ErrorKind::kType:
      return "TypeError";
    case ErrorKind::kRange:
      return "RangeError";
    case ErrorKind::kSyntax:
      return "SyntaxError";
    case ErrorKind::kAssert:
      return "ImplementationError";
  }
  // Unreachable; here only to satisfy compilers that don't see the
  // exhaustive switch.
  return "Error";
}

TemporalError TemporalError::Generic(std::string_view msg) noexcept {
  return TemporalError{ErrorKind::kGeneric, std::string(msg)};
}

TemporalError TemporalError::Type(std::string_view msg) noexcept {
  return TemporalError{ErrorKind::kType, std::string(msg)};
}

TemporalError TemporalError::Range(std::string_view msg) noexcept {
  return TemporalError{ErrorKind::kRange, std::string(msg)};
}

TemporalError TemporalError::Syntax(std::string_view msg) noexcept {
  return TemporalError{ErrorKind::kSyntax, std::string(msg)};
}

TemporalError TemporalError::Assert(std::string_view msg) noexcept {
  return TemporalError{ErrorKind::kAssert, std::string(msg)};
}

}  // namespace temporal
}  // namespace socketsecurity
}  // namespace node
