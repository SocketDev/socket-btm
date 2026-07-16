// Compat shim: temporal_rs::I128Nanoseconds — a {high, low} struct
// that V8 uses to pass 128-bit nanosecond counts across the FFI
// boundary. We expose the same layout (so V8's struct literals
// `{.high=…, .low=…}` work) and provide a bridge to/from our
// `Int128` shim type.

#ifndef TEMPORAL_RS_COMPAT_I128NANOSECONDS_HPP_
#define TEMPORAL_RS_COMPAT_I128NANOSECONDS_HPP_

#include <cstdint>

#include "socketsecurity/temporal/temporal.h"
#include "socketsecurity/temporal/temporal_int128.h"

namespace temporal_rs {

struct I128Nanoseconds {
  // Same layout as upstream's diplomat-generated I128Nanoseconds.
  // Diplomat splits i128 into hi/lo because most C ABIs don't carry
  // 128-bit struct members natively. The C++ side reassembles via
  // bit-shifting at the call boundary.
  uint64_t high;
  uint64_t low;

  // Bridge to/from temporal-infra's Int128.
  static I128Nanoseconds FromInfra(
      ::node::socketsecurity::temporal::Int128 v) {
    using NativeInt128 =
        ::node::socketsecurity::temporal::NativeInt128;
    NativeInt128 raw = v.value;
    // High = upper 64 bits as raw two's-complement; low = lower 64
    // unsigned.
    const uint64_t low = static_cast<uint64_t>(raw);
    // Right-shift on a signed 128-bit type is implementation-defined
    // for negatives; cast to uint128 first to keep it logical.
    using NativeUInt128 = unsigned __int128;
    NativeUInt128 raw_u = static_cast<NativeUInt128>(raw);
    const uint64_t high = static_cast<uint64_t>(raw_u >> 64);
    return I128Nanoseconds{high, low};
  }

  ::node::socketsecurity::temporal::Int128 ToInfra() const {
    using NativeInt128 =
        ::node::socketsecurity::temporal::NativeInt128;
    using NativeUInt128 = unsigned __int128;
    NativeUInt128 combined = (static_cast<NativeUInt128>(high) << 64) |
                              static_cast<NativeUInt128>(low);
    return ::node::socketsecurity::temporal::Int128(
        static_cast<NativeInt128>(combined));
  }

  // Spec: IsValidEpochNanoseconds - the value is a valid epoch
  // nanosecond count for an Instant if it lies within ±86400e17.
  // Defer to temporal-infra's Instant validity check.
  bool is_valid() const {
    ::node::socketsecurity::temporal::Instant i{};
    i.epoch_nanoseconds = ToInfra();
    return i.IsValid();
  }
};

}  // namespace temporal_rs

#endif  // TEMPORAL_RS_COMPAT_I128NANOSECONDS_HPP_
