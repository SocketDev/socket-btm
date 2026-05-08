// Compat shim: temporal_rs::Provider — heap-owned wrapper around
// node::socketsecurity::temporal::TzdbProvider. Upstream's diplomat
// surface uses Provider as a handle that V8 holds; the C++ port
// resolves IANA queries through the registered TimeZoneBackend
// (V8 installs a zoneinfo64-backed backend at boot), so this is a
// thin marker class — operations route through TimeZone, not through
// Provider directly.

#ifndef TEMPORAL_RS_COMPAT_PROVIDER_HPP_
#define TEMPORAL_RS_COMPAT_PROVIDER_HPP_

#include <cstdint>
#include <memory>
#include <variant>

#include "socketsecurity/temporal/tzdb.h"
#include "temporal_rs/Provider.d.hpp"
#include "temporal_rs/diplomat_runtime.hpp"

namespace temporal_rs {

class Provider {
 public:
  static std::unique_ptr<Provider> compiled() {
    return std::unique_ptr<Provider>(new Provider());
  }

  static std::unique_ptr<Provider> new_compiled() {
    return std::unique_ptr<Provider>(new Provider());
  }

  // Upstream gates the FS provider behind a feature flag; we don't
  // re-implement it (V8/ICU already provides FS-backed tzdata).
  static std::unique_ptr<Provider> fs() {
    return std::unique_ptr<Provider>(new Provider());
  }

  // V8's js-temporal-zoneinfo64.cc calls these. The TimeZoneBackend
  // installed at boot resolves IANA queries through ICU + zoneinfo64,
  // so the actual zoneinfo64 byte buffer doesn't need to be parsed
  // here — V8 has its own ICU-backed tzdata. We return an Ok result
  // with a fresh marker Provider so the V8 caller's
  // `std::move(result).ok().value()` gets a usable instance.
  static diplomat::result<std::unique_ptr<Provider>, std::monostate>
  new_zoneinfo64(diplomat::span<const uint32_t> /* data */) {
    return diplomat::result<std::unique_ptr<Provider>, std::monostate>(
        diplomat::Ok<std::unique_ptr<Provider>>(
            std::unique_ptr<Provider>(new Provider())));
  }

  // Fallback factory V8 uses when zoneinfo64 data is unavailable.
  static std::unique_ptr<Provider> empty() {
    return std::unique_ptr<Provider>(new Provider());
  }

  Provider(const Provider&) = delete;
  Provider(Provider&&) noexcept = delete;
  Provider& operator=(const Provider&) = delete;
  Provider& operator=(Provider&&) noexcept = delete;

 private:
  Provider() = default;
};

}  // namespace temporal_rs

#endif  // TEMPORAL_RS_COMPAT_PROVIDER_HPP_
