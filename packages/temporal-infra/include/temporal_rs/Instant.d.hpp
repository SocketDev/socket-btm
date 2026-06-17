// Compat shim: V8 includes both `temporal_rs/Instant.d.hpp` (diplomat
// declarations header) and `temporal_rs/Instant.hpp` (definitions). Our
// shim doesn't split the two — Instant.hpp holds the entire class with
// inline bodies, so the `.d.hpp` is a single-line redirect.
#include "temporal_rs/Instant.hpp"
