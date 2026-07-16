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

  // V8's js-temporal-zoneinfo64.cc passes us the raw zoneinfo64 byte
  // buffer (uint32_t-aligned per ICU's udata format). We store the
  // span pointer + length for API parity with upstream's
  // `TimeZoneProvider` trait; IANA wall-clock <-> instant resolution
  // routes through the registered `TimeZoneBackend` (which V8 wires
  // to `IcuTimeZoneBackend` at boot), not by re-parsing this buffer.
  static diplomat::result<std::unique_ptr<Provider>, std::monostate>
  new_zoneinfo64(diplomat::span<const uint32_t> data) {
    auto p = std::unique_ptr<Provider>(new Provider());
    p->zoneinfo64_data_ = data.data();
    p->zoneinfo64_size_ = data.size();
    return diplomat::result<std::unique_ptr<Provider>, std::monostate>(
        diplomat::Ok<std::unique_ptr<Provider>>(std::move(p)));
  }

  // Fallback factory V8 uses when zoneinfo64 data is unavailable.
  // The resulting Provider has no IANA data — only offset-only TZs
  // will work through it.
  static std::unique_ptr<Provider> empty() {
    return std::unique_ptr<Provider>(new Provider());
  }

  // Accessors for the held zoneinfo64 buffer. Both default to a
  // null/zero state when the Provider was constructed without
  // zoneinfo64 data (the `compiled()`, `new_compiled()`, `fs()`,
  // `empty()` paths). Real consumers must null-check before walking
  // the buffer.
  const uint32_t* zoneinfo64_data() const noexcept {
    return zoneinfo64_data_;
  }
  size_t zoneinfo64_size() const noexcept { return zoneinfo64_size_; }
  bool has_zoneinfo64() const noexcept {
    return zoneinfo64_data_ != nullptr && zoneinfo64_size_ > 0;
  }

  Provider(const Provider&) = delete;
  Provider(Provider&&) noexcept = delete;
  Provider& operator=(const Provider&) = delete;
  Provider& operator=(Provider&&) noexcept = delete;

 private:
  Provider() = default;

  // Borrowed span — V8's ZoneInfo64Provider singleton owns the
  // underlying ICU UDataMemory and outlives every Provider instance
  // it produces. Holding a non-owning pointer matches upstream's
  // diplomat-generated lifetime contract (Provider is constructed
  // from a borrowed span and is itself heap-owned by V8).
  const uint32_t* zoneinfo64_data_ = nullptr;
  size_t zoneinfo64_size_ = 0;
};

}  // namespace temporal_rs

#endif  // TEMPORAL_RS_COMPAT_PROVIDER_HPP_
