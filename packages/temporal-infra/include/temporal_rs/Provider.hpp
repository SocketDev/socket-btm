// Compat shim: temporal_rs::Provider — heap-owned wrapper around
// node::socketsecurity::temporal::TzdbProvider. Upstream's diplomat
// surface uses Provider as a handle that V8 holds; the C++ port
// resolves IANA queries through the registered TimeZoneBackend
// (V8 installs a zoneinfo64-backed backend at boot), so this is a
// thin marker class — operations route through TimeZone, not through
// Provider directly.

#ifndef TEMPORAL_RS_COMPAT_PROVIDER_HPP_
#define TEMPORAL_RS_COMPAT_PROVIDER_HPP_

#include <memory>

#include "socketsecurity/temporal/tzdb.h"

namespace temporal_rs {

class Provider {
 public:
  static std::unique_ptr<Provider> compiled() {
    return std::unique_ptr<Provider>(new Provider());
  }

  // Upstream gates the FS provider behind a feature flag; we don't
  // re-implement it (V8/ICU already provides FS-backed tzdata).
  static std::unique_ptr<Provider> fs() {
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
