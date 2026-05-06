// 1:1 port of upstream `src/tzdb.rs` at temporal v0.2.3.
//
// Upstream re-exports two providers (CompiledTzdbProvider + FsTzdbProvider)
// and gates them behind cargo features. The C++ port intentionally does
// NOT re-implement these — V8 already ships:
//   - deps/v8/src/objects/js-temporal-zoneinfo64.cc — V8's vendored
//     ICU zoneinfo64 IANA lookup table
//   - deps/icu-small (or deps/icu, depending on the build) — full
//     time-zone data, including DST transitions
//
// The `TimeZone` class (forthcoming time_zone.cc) calls into these
// V8-provided routines instead of re-vendoring tzif data. This file
// therefore holds only the public-facing type forward decls so other
// .h files can mention "the V8 tzdb" without dragging in V8 headers.

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
