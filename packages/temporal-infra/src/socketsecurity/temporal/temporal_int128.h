// 128-bit signed integer for Temporal Instant arithmetic.
//
// Temporal's Instant range is ±10^8 days from epoch ≈ ±8.64×10^21
// nanoseconds — fits in 75 bits, so int128 is comfortable. We use the
// compiler's `__int128` extension on GCC/Clang (which V8 itself uses
// for its bignum and time arithmetic). MSVC has no __int128, so on
// MSVC we use absl::int128 (V8 already vendors abseil at
// deps/v8/third_party/abseil-cpp/, and absl::int128 is the canonical
// portability shim for this exact case).

#ifndef SRC_SOCKETSECURITY_TEMPORAL_TEMPORAL_INT128_H_
#define SRC_SOCKETSECURITY_TEMPORAL_TEMPORAL_INT128_H_

#include <cstdint>

#if defined(__SIZEOF_INT128__)
// GCC / Clang: native __int128. This is V8's preferred path on Linux/
// macOS — see deps/v8/src/base/numbers/bignum.cc which uses the same
// extension for its own arithmetic.
#  define NODE_TEMPORAL_HAS_NATIVE_INT128 1
#else
// MSVC fallback. absl::int128 is V8-vendored at
// deps/v8/third_party/abseil-cpp/absl/numeric/int128.h.
#  include "absl/numeric/int128.h"
#  define NODE_TEMPORAL_HAS_NATIVE_INT128 0
#endif

namespace node {
namespace socketsecurity {
namespace temporal {

#if NODE_TEMPORAL_HAS_NATIVE_INT128
using NativeInt128 = __int128;
#else
using NativeInt128 = absl::int128;
#endif

// Public-facing Int128 wrapper. Trivial type for ABI stability — the
// underlying NativeInt128 is the heavy lifter. We expose a thin shim
// so the public temporal.h header doesn't pull in compiler-specific
// or absl-specific includes.
struct Int128 {
  NativeInt128 value;

  constexpr Int128() noexcept : value(0) {}
  constexpr Int128(NativeInt128 v) noexcept : value(v) {}
  constexpr Int128(int64_t v) noexcept : value(v) {}

  constexpr Int128 operator+(Int128 o) const noexcept {
    return Int128(value + o.value);
  }
  constexpr Int128 operator-(Int128 o) const noexcept {
    return Int128(value - o.value);
  }
  constexpr Int128 operator*(Int128 o) const noexcept {
    return Int128(value * o.value);
  }
  // Truncated (toward-zero) division. Caller ensures o != 0.
  constexpr Int128 operator/(Int128 o) const noexcept {
    return Int128(value / o.value);
  }
  // Truncated remainder. Sign follows the dividend (C++ semantics).
  constexpr Int128 operator%(Int128 o) const noexcept {
    return Int128(value % o.value);
  }
  constexpr Int128 operator-() const noexcept { return Int128(-value); }
  constexpr bool operator==(Int128 o) const noexcept {
    return value == o.value;
  }
  constexpr bool operator!=(Int128 o) const noexcept {
    return value != o.value;
  }
  constexpr bool operator<(Int128 o) const noexcept { return value < o.value; }
  constexpr bool operator<=(Int128 o) const noexcept {
    return value <= o.value;
  }
  constexpr bool operator>(Int128 o) const noexcept { return value > o.value; }
  constexpr bool operator>=(Int128 o) const noexcept {
    return value >= o.value;
  }

  // Lossy narrow to int64. Caller must verify range first.
  constexpr int64_t ToInt64() const noexcept {
    return static_cast<int64_t>(value);
  }
};

// Maximum valid Instant magnitude per the spec: 8.64 × 10^21 nanoseconds.
// This is 86_400 × 10^17, computed as days * ns/day where days = 10^8
// and ns/day = 86_400 × 10^9. Stored as a constexpr so callers can
// compare against it without recomputing the multiplication every time.
constexpr Int128 kMaxInstantNanoseconds() noexcept {
  // 86_400 * 10^9 = 86_400_000_000_000 (ns per day, fits in int64)
  // multiplied by 10^8 (max days) = 8.64 × 10^21 (needs 128-bit)
  NativeInt128 ns_per_day = NativeInt128{86'400'000'000'000LL};
  NativeInt128 max_days = NativeInt128{100'000'000LL};
  return Int128(ns_per_day * max_days);
}

}  // namespace temporal
}  // namespace socketsecurity
}  // namespace node

#endif  // SRC_SOCKETSECURITY_TEMPORAL_TEMPORAL_INT128_H_
