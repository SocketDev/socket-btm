// Compat shim: temporal_rs::Provider declaration header (the .d.hpp
// matches diplomat's split where .d.hpp holds declarations and .hpp
// holds definitions). V8's deps/v8/src/objects/js-temporal-zoneinfo64.h
// includes this exact path (`#include "temporal_rs/Provider.d.hpp"`),
// so it must exist by name even if the bulk of the surface lives in
// Provider.hpp for our shim's purposes.

#ifndef TEMPORAL_RS_COMPAT_PROVIDER_D_HPP_
#define TEMPORAL_RS_COMPAT_PROVIDER_D_HPP_

#include <cstdint>
#include <memory>
#include <variant>

#include "temporal_rs/diplomat_runtime.hpp"

namespace temporal_rs {

class Provider;

}  // namespace temporal_rs

#endif  // TEMPORAL_RS_COMPAT_PROVIDER_D_HPP_
