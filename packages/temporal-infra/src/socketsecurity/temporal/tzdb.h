// 1:1 port of upstream `src/tzdb.rs` at temporal v0.2.3.
//
// Upstream re-exports two providers (CompiledTzdbProvider + FsTzdbProvider)
// and gates them behind cargo features. The C++ port intentionally does
// NOT re-implement these — V8 already ships:
//   - deps/v8/src/objects/js-temporal-zoneinfo64.cc — V8's vendored
//     ICU zoneinfo64 IANA lookup table
//   - deps/icu-small / deps/icu — full time-zone data, including DST
//     transitions
//
// The `TimeZone` class in time_zone.h delegates to a registered
// `TimeZoneBackend`; the V8 binding installs a backend that calls
// into V8/ICU. This file holds only forward decls so other headers
// can mention "the tzdb" without pulling V8 headers.

#ifndef SRC_SOCKETSECURITY_TEMPORAL_TZDB_H_
#define SRC_SOCKETSECURITY_TEMPORAL_TZDB_H_

namespace node {
namespace socketsecurity {
namespace temporal {

// Marker type — concrete impl lives in time_zone.cc, backed by V8's
// existing zoneinfo64 + ICU bindings.
class TzdbProvider;

}  // namespace temporal
}  // namespace socketsecurity
}  // namespace node

#endif  // SRC_SOCKETSECURITY_TEMPORAL_TZDB_H_
