// node:smol-versions — native semver parser and comparator.
//
// Exposes the hot subset of npm's `semver` package as an internal
// binding so socket-lib's dependency-resolution paths can skip the
// per-call cost of JS-level regex parsing + intermediate object
// construction.

#ifndef SRC_SOCKETSECURITY_VERSIONS_VERSIONS_H_
#define SRC_SOCKETSECURITY_VERSIONS_VERSIONS_H_

#if defined(NODE_WANT_INTERNALS) && NODE_WANT_INTERNALS

#include <cstdint>
#include <string>
#include <vector>

namespace node {
namespace socketsecurity {
namespace versions {

// Maximum stack-allocated bytes for a single prerelease / build span.
// Anything longer spills to heap. 64 covers >99% of real-world
// version strings (median pre-release length is 6-12 chars).
inline constexpr size_t kStackSpanLimit = 64;

// SemVer — the parsed form of a version string.
//
// Designed to fit in two cache lines and be cheap to copy around for
// comparisons. Spec: https://semver.org/spec/v2.0.0.html
struct SemVer {
  uint64_t major = 0;
  uint64_t minor = 0;
  uint64_t patch = 0;
  // Prerelease and build are stored as offsets into the original
  // input buffer to avoid copying. The caller (the parser) keeps the
  // input alive for the lifetime of the SemVer.
  // Empty span: prerelease_off == prerelease_end == 0.
  // Identifiers within a prerelease are dot-separated; comparison
  // re-scans the span identifier-by-identifier (cheap because the
  // span is short).
  const char* prerelease = nullptr;
  size_t prerelease_len = 0;
  const char* build = nullptr;
  size_t build_len = 0;
  // True iff this SemVer was successfully parsed. False values have
  // undefined contents and must not be compared.
  bool valid = false;
};

// Parse a version string into a SemVer. Returns true on success.
// Loose parsing accepts a leading 'v' / '=' and surrounding
// whitespace; strict requires bare "X.Y.Z[-pre][+build]".
//
// `source` must outlive the returned SemVer (we store offsets into
// it for prerelease + build).
bool ParseSemVer(const char* source, size_t len, bool loose, SemVer* out);

// Spec § 11 comparison: -1 if a < b, 0 if a == b, 1 if a > b.
// Build metadata is ignored. Both sides must be valid; passing an
// invalid SemVer is undefined.
int CompareSemVer(const SemVer& a, const SemVer& b);

// Range parser — parses a range expression into a list of comparator
// sets. The range matches a version iff *any* set matches AND every
// comparator within that set matches.
//
// Comparator: a (operator, version) pair. Operators are =, !=, >, <,
// >=, <=. Caret / tilde / hyphen / x-range / wildcard syntaxes get
// expanded into one or more (operator, version) comparators at parse
// time.
struct Comparator {
  // 0=eq, 1=neq, 2=gt, 3=lt, 4=gte, 5=lte, 6=any (matches anything).
  uint8_t op = 6;
  SemVer version;
  // For prerelease handling: the original string of the version part
  // of this comparator's source. Used by the include-prerelease
  // matching rule.
  const char* version_source = nullptr;
  size_t version_source_len = 0;
};

// Range — a disjunction of comparator sets. A version satisfies the
// range iff at least one set matches, where a set matches iff every
// comparator within it matches.
struct Range {
  std::vector<std::vector<Comparator>> sets;
  // Owned storage for any version strings synthesized by the range
  // parser (e.g. caret/tilde/hyphen expansions allocate string
  // buffers; comparators reference into here).
  std::vector<std::string> owned_strings;
  bool valid = false;
};

bool ParseRange(const char* source, size_t len, bool loose, Range* out);

// Spec satisfies: does `v` match `r`? `include_prerelease` controls
// whether prerelease versions are matchable in non-prerelease ranges
// (the `includePrerelease` option in JS semver).
bool RangeSatisfies(const SemVer& v,
                    const Range& r,
                    bool include_prerelease);

}  // namespace versions
}  // namespace socketsecurity
}  // namespace node

#endif  // NODE_WANT_INTERNALS

#endif  // SRC_SOCKETSECURITY_VERSIONS_VERSIONS_H_
