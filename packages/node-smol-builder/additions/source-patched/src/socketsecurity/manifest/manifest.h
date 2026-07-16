// node:smol-manifest — native lockfile parsers.
//
// Exposes the hot per-ecosystem parsers as `smol_manifest_native`.
// The shape produced matches socket-lib's TS `ParsedLockfile` so
// downstream consumers don't branch on smol-vs-stock-Node.
//
// Reference: docs/plans/smol-manifest-native-full.md.
//
// Algorithm oracle: socket-sdxgen/src/parsers/<eco>/*.mts.

#ifndef SRC_SOCKETSECURITY_MANIFEST_MANIFEST_H_
#define SRC_SOCKETSECURITY_MANIFEST_MANIFEST_H_

#if defined(NODE_WANT_INTERNALS) && NODE_WANT_INTERNALS

#include <cstdint>
#include <string>
#include <string_view>
#include <variant>
#include <vector>

#include "arena.h"
#include "intern.h"

namespace node {
namespace socketsecurity {
namespace manifest {

// Wire-format enum values shared with JS. The numeric values are
// pinned and form part of the binding's public contract — bumping
// them is a breaking change. JS-side mirror in
// test/smol-manifest-native.test.mts (ECO_*, FMT_*).
enum class Ecosystem : uint8_t {
  kNpm = 0,
  kCargo = 1,
};

enum class LockFormat : uint8_t {
  kNpm = 0,
  kPnpm = 1,
  kYarn = 2,
  kCargo = 3,
};

enum class DepType : uint8_t {
  kProd = 0,
  kDev = 1,
  kOptional = 2,
  kPeer = 3,
};

// PackageRef — one dependency entry in the parsed result.
//
// Field order roughly hot→cold. Owned views (name / version / etc.)
// point into either the input buffer (the parser keeps it alive) or
// into the arena (for synthesized strings like peer-stripped
// versions). The lifetime contract: PackageRef views are valid for
// the lifetime of the owning ParsedLockfile.
struct PackageRef {
  std::string_view name;
  std::string_view version;
  std::string_view resolved;
  std::string_view integrity;
  std::string_view license;
  std::string_view vcsUrl;
  std::string_view vcsCommit;
  std::vector<std::string_view> dependencies;
  DepType depType = DepType::kProd;
  bool isDev = false;
  bool isOptional = false;
  bool isPeer = false;
  bool isBundled = false;
};

// PackageIndex entry: either a single index or a list of indices.
// Matches the JS `_index` shape: `Record<string, number | number[]>`.
using PackageIndexValue = std::variant<uint32_t, std::vector<uint32_t>>;

struct ParsedLockfile {
  // Always "lockfile" — placeholder for future manifest support.
  std::string_view type = "lockfile";
  // Lockfile-format-specific version string. npm: "1" / "2" / "3".
  // pnpm: "5" / "6" / "9". yarn: "1" / "berry". cargo: "0.0.0".
  std::string_view lockVersion;
  Ecosystem ecosystem = Ecosystem::kNpm;
  std::vector<PackageRef> packages;
  // Maps lockfile-key → index in packages[]. Multi-version entries
  // hold a vector. See per-ecosystem README files in the fixture
  // set for the exact keying rules per format.
  std::vector<std::pair<std::string_view, PackageIndexValue>> index;
};

// Parse error — non-throwing failure mode. JS binding converts this
// into a ManifestError instance with the matching `.code`.
struct ParseError {
  std::string message;
  // Stable error codes shared with the JS impl:
  // 'ERR_INVALID_JSON', 'ERR_INVALID_LOCKFILE', 'ERR_UNSUPPORTED'.
  std::string code;
};

// State carried by every parser. Holds the arena that owns
// synthesized strings + the interner that dedupes names.
struct ParseContext {
  Arena arena;
  StringInterner intern{&arena};
};

// Single dispatch entry point. Routes on (ecosystem, format).
// Returns true on success (fills `out`); returns false on parse
// failure (fills `err`). Never throws C++ exceptions.
bool ParseLockfile(std::string_view content,
                   Ecosystem ecosystem,
                   LockFormat format,
                   ParseContext* ctx,
                   ParsedLockfile* out,
                   ParseError* err);

}  // namespace manifest
}  // namespace socketsecurity
}  // namespace node

#endif  // NODE_WANT_INTERNALS
#endif  // SRC_SOCKETSECURITY_MANIFEST_MANIFEST_H_
