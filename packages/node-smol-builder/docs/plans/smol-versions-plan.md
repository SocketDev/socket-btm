# smol-versions Implementation Plan

## Overview

`node:smol-versions` provides high-performance multi-ecosystem version parsing, comparison, and range matching. Supports npm, Maven, PyPI, NuGet, RubyGems, Cargo, Go, and more. Target: **50-100x faster** than JavaScript implementations.

## Performance Strategy for 50-100x

### Key Optimizations
1. **Packed version representation** - Version fits in 32 bytes (cache line friendly)
2. **SIMD digit parsing** - Parse all numeric components in parallel
3. **Zero-copy string views** - No string allocation during parsing
4. **Perfect hash for range operators** - ^, ~, >=, etc. in O(1)
5. **Branchless comparison** - Subtract and check sign bit
6. **Compile-time prerelease ranking** - alpha/beta/rc as integers
7. **Lock-free LRU cache** - Concurrent access without mutex

## Reference Implementations

Based on analysis of:
- `coana-package-manager/src/compare/` - Multi-ecosystem version comparison
- `socket-sbom-generator` - Version parsing for SBOMs
- Individual ecosystem libraries (semver, maven-artifact, etc.)

## Ecosystem-Specific Semantics

| Ecosystem | Version Format | Special Rules |
|-----------|---------------|---------------|
| npm | SemVer 2.0 | Prerelease < release |
| Maven | Complex | Qualifiers: alpha < beta < milestone < rc < snapshot < release |
| PyPI | PEP 440 | dev < alpha < beta < rc < post |
| NuGet | SemVer 1.0 | 4th component allowed |
| RubyGems | Relaxed SemVer | Prerelease segments |
| Cargo | Strict SemVer | Pre-release required format |
| Go | SemVer + pseudo | v prefix, +incompatible |

## C++ Architecture

### Header: `smol_versions_binding.h`

```cpp
#ifndef SRC_SMOL_VERSIONS_BINDING_H_
#define SRC_SMOL_VERSIONS_BINDING_H_

#include <string>
#include <string_view>
#include <variant>
#include <vector>
#include <optional>
#include <cstdint>

namespace node {
namespace smol_versions {

// Ecosystem type
enum class Ecosystem : uint8_t {
  kNpm = 0,
  kMaven = 1,
  kPypi = 2,
  kNuget = 3,
  kGem = 4,
  kCargo = 5,
  kGolang = 6,
  kComposer = 7,
  kHex = 8,
  kPub = 9,
  kSwift = 10,
  kGeneric = 255,
};

// Prerelease identifier (either numeric or string)
struct PrereleaseId {
  bool is_numeric;
  union {
    uint64_t num;
    struct {
      const char* str;
      size_t len;
    };
  };

  int Compare(const PrereleaseId& other) const;
};

// Parsed version components
struct Version {
  // Numeric components (up to 4 for NuGet compatibility)
  uint64_t major = 0;
  uint64_t minor = 0;
  uint64_t patch = 0;
  uint64_t build = 0;  // 4th component for NuGet
  uint8_t num_components = 3;

  // Prerelease identifiers
  std::vector<PrereleaseId> prerelease;

  // Build metadata (ignored in comparison)
  std::string_view build_metadata;

  // Original string for display
  std::string_view original;

  // Ecosystem-specific data
  Ecosystem ecosystem = Ecosystem::kGeneric;

  // Maven qualifier rank (if maven)
  int maven_qualifier_rank = 0;

  // PyPI epoch
  uint64_t pypi_epoch = 0;

  // Parsing status
  bool valid = false;
  const char* error = nullptr;
};

// Comparison result
enum class CompareResult : int8_t {
  kLess = -1,
  kEqual = 0,
  kGreater = 1,
};

// Version parser with ecosystem-specific logic
class VersionParser {
 public:
  // Parse version string
  static Version Parse(std::string_view input, Ecosystem eco = Ecosystem::kGeneric);

  // Parse with auto-detection
  static Version ParseAuto(std::string_view input);

  // Batch parse
  static std::vector<Version> ParseBatch(
      const std::vector<std::string_view>& inputs,
      Ecosystem eco);

  // Compare two versions
  static CompareResult Compare(const Version& a, const Version& b);

  // Compare version strings directly (no allocation path)
  static CompareResult CompareStrings(
      std::string_view a,
      std::string_view b,
      Ecosystem eco);

  // Sort versions in place
  static void Sort(std::vector<Version>& versions, bool descending = false);

  // Find max/min
  static const Version* Max(const std::vector<Version>& versions);
  static const Version* Min(const std::vector<Version>& versions);

 private:
  // Ecosystem-specific parsers
  static Version ParseNpm(std::string_view input);
  static Version ParseMaven(std::string_view input);
  static Version ParsePypi(std::string_view input);
  static Version ParseNuget(std::string_view input);
  static Version ParseGem(std::string_view input);
  static Version ParseCargo(std::string_view input);
  static Version ParseGolang(std::string_view input);

  // Ecosystem-specific comparators
  static CompareResult CompareNpm(const Version& a, const Version& b);
  static CompareResult CompareMaven(const Version& a, const Version& b);
  static CompareResult ComparePypi(const Version& a, const Version& b);
};

// Version range for dependency resolution
class VersionRange {
 public:
  // Parse range expression
  static std::optional<VersionRange> Parse(
      std::string_view expr,
      Ecosystem eco);

  // Check if version satisfies range
  bool Satisfies(const Version& version) const;
  bool Satisfies(std::string_view version_str) const;

  // Find best match from list
  const Version* BestMatch(const std::vector<Version>& versions) const;

  // Range operators
  enum class Op : uint8_t {
    kExact,      // =1.0.0
    kGt,         // >1.0.0
    kGte,        // >=1.0.0
    kLt,         // <1.0.0
    kLte,        // <=1.0.0
    kCaret,      // ^1.0.0
    kTilde,      // ~1.0.0
    kHyphen,     // 1.0.0 - 2.0.0
    kWildcard,   // 1.x, 1.0.*
  };

 private:
  struct Comparator {
    Op op;
    Version version;
  };

  std::vector<std::vector<Comparator>> ranges_;  // OR of ANDs
  Ecosystem ecosystem_;
};

// LRU cache for parsed versions
class VersionCache {
 public:
  explicit VersionCache(size_t max_size = 50000);

  const Version* Get(std::string_view version, Ecosystem eco) const;
  void Put(std::string_view version, Ecosystem eco, Version parsed);
  void Clear();

  struct Stats {
    size_t size;
    size_t hits;
    size_t misses;
  };
  Stats GetStats() const;

 private:
  // Hash key: version string + ecosystem
  struct CacheKey {
    std::string version;
    Ecosystem ecosystem;

    bool operator==(const CacheKey& other) const;
  };
  struct CacheKeyHash {
    size_t operator()(const CacheKey& key) const;
  };
  // LRU implementation...
};

// Maven-specific qualifier ranking
namespace maven {
  // Returns rank (lower = earlier in release cycle)
  // alpha/a < beta/b < milestone/m < rc/cr < snapshot < (empty) < sp
  int QualifierRank(std::string_view qualifier);

  // Tokenize Maven version
  struct MavenToken {
    enum Type { kNumber, kString, kSeparator };
    Type type;
    std::string_view value;
    uint64_t num_value;  // if type == kNumber
  };
  std::vector<MavenToken> Tokenize(std::string_view version);
}

// PyPI PEP 440 specifics
namespace pypi {
  // Parse epoch (e.g., "1!" prefix)
  std::pair<uint64_t, std::string_view> ParseEpoch(std::string_view input);

  // Normalize version string
  std::string Normalize(std::string_view version);

  // Release segment rank
  // dev < alpha/a < beta/b < rc/c < (release) < post
  int SegmentRank(std::string_view segment);
}

}  // namespace smol_versions
}  // namespace node

#endif  // SRC_SMOL_VERSIONS_BINDING_H_
```

### V8 Binding: `smol_versions_v8_binding.cc`

```cpp
#include "smol_versions_binding.h"
#include "env-inl.h"
#include "node_internals.h"
#include "v8.h"

namespace node {
namespace smol_versions {

using v8::Array;
using v8::Context;
using v8::FunctionCallbackInfo;
using v8::Int32;
using v8::Isolate;
using v8::Local;
using v8::Object;
using v8::String;
using v8::Value;

// Parse a version string
void Parse(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();

  if (args.Length() < 1 || !args[0]->IsString()) {
    isolate->ThrowException(v8::Exception::TypeError(
        String::NewFromUtf8Literal(isolate, "Expected version string")));
    return;
  }

  Ecosystem eco = Ecosystem::kGeneric;
  if (args.Length() >= 2 && args[1]->IsString()) {
    v8::String::Utf8Value eco_str(isolate, args[1]);
    eco = EcosystemFromString(*eco_str);
  }

  v8::String::Utf8Value input(isolate, args[0]);
  Version result = VersionParser::Parse(
      std::string_view(*input, input.length()), eco);

  if (!result.valid) {
    isolate->ThrowException(v8::Exception::Error(
        String::NewFromUtf8(isolate, result.error).ToLocalChecked()));
    return;
  }

  // Build result object
  Local<Object> obj = Object::New(isolate);
  obj->Set(context,
      String::NewFromUtf8Literal(isolate, "major"),
      v8::BigInt::NewFromUnsigned(isolate, result.major)
  ).Check();
  obj->Set(context,
      String::NewFromUtf8Literal(isolate, "minor"),
      v8::BigInt::NewFromUnsigned(isolate, result.minor)
  ).Check();
  obj->Set(context,
      String::NewFromUtf8Literal(isolate, "patch"),
      v8::BigInt::NewFromUnsigned(isolate, result.patch)
  ).Check();

  // Prerelease array
  if (!result.prerelease.empty()) {
    Local<Array> pre = Array::New(isolate, result.prerelease.size());
    for (size_t i = 0; i < result.prerelease.size(); i++) {
      const auto& id = result.prerelease[i];
      if (id.is_numeric) {
        pre->Set(context, i, v8::BigInt::NewFromUnsigned(isolate, id.num)).Check();
      } else {
        pre->Set(context, i,
            String::NewFromUtf8(isolate, id.str, v8::NewStringType::kNormal, id.len)
                .ToLocalChecked()).Check();
      }
    }
    obj->Set(context, String::NewFromUtf8Literal(isolate, "prerelease"), pre).Check();
  }

  args.GetReturnValue().Set(obj);
}

// Compare two versions
void Compare(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();

  if (args.Length() < 2 || !args[0]->IsString() || !args[1]->IsString()) {
    isolate->ThrowException(v8::Exception::TypeError(
        String::NewFromUtf8Literal(isolate, "Expected two version strings")));
    return;
  }

  Ecosystem eco = Ecosystem::kGeneric;
  if (args.Length() >= 3 && args[2]->IsString()) {
    v8::String::Utf8Value eco_str(isolate, args[2]);
    eco = EcosystemFromString(*eco_str);
  }

  v8::String::Utf8Value a(isolate, args[0]);
  v8::String::Utf8Value b(isolate, args[1]);

  CompareResult result = VersionParser::CompareStrings(
      std::string_view(*a, a.length()),
      std::string_view(*b, b.length()),
      eco);

  args.GetReturnValue().Set(static_cast<int32_t>(result));
}

// Sort versions
void Sort(const FunctionCallbackInfo<Value>& args) {
  // Implementation
}

// Check if version satisfies range
void Satisfies(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();

  if (args.Length() < 2 || !args[0]->IsString() || !args[1]->IsString()) {
    isolate->ThrowException(v8::Exception::TypeError(
        String::NewFromUtf8Literal(isolate, "Expected version and range strings")));
    return;
  }

  Ecosystem eco = Ecosystem::kNpm;  // Default for ranges
  if (args.Length() >= 3 && args[2]->IsString()) {
    v8::String::Utf8Value eco_str(isolate, args[2]);
    eco = EcosystemFromString(*eco_str);
  }

  v8::String::Utf8Value version(isolate, args[0]);
  v8::String::Utf8Value range(isolate, args[1]);

  auto parsed_range = VersionRange::Parse(
      std::string_view(*range, range.length()), eco);

  if (!parsed_range) {
    isolate->ThrowException(v8::Exception::Error(
        String::NewFromUtf8Literal(isolate, "Invalid version range")));
    return;
  }

  bool result = parsed_range->Satisfies(
      std::string_view(*version, version.length()));

  args.GetReturnValue().Set(result);
}

void Initialize(Local<Object> target,
                Local<Value> unused,
                Local<Context> context,
                void* priv) {
  Environment* env = Environment::GetCurrent(context);

  env->SetMethod(target, "parse", Parse);
  env->SetMethod(target, "compare", Compare);
  env->SetMethod(target, "sort", Sort);
  env->SetMethod(target, "satisfies", Satisfies);
  env->SetMethod(target, "maxSatisfying", MaxSatisfying);
  env->SetMethod(target, "minSatisfying", MinSatisfying);
}

NODE_MODULE_CONTEXT_AWARE_INTERNAL(smol_versions, Initialize)

}  // namespace smol_versions
}  // namespace node
```

## TypeScript Interface

### `lib/internal/smol_versions.d.ts`

```typescript
declare module 'node:smol-versions' {
  export type Ecosystem =
    | 'npm' | 'maven' | 'pypi' | 'nuget' | 'gem'
    | 'cargo' | 'golang' | 'composer' | 'hex' | 'pub' | 'swift';

  export interface ParsedVersion {
    /** Major version number */
    readonly major: bigint;
    /** Minor version number */
    readonly minor: bigint;
    /** Patch version number */
    readonly patch: bigint;
    /** Build number (4th component, mainly for NuGet) */
    readonly build?: bigint;
    /** Prerelease identifiers */
    readonly prerelease: ReadonlyArray<string | bigint>;
    /** Build metadata */
    readonly buildMetadata?: string;
    /** Original version string */
    readonly raw: string;
  }

  /**
   * Parse a version string
   * @param version Version string to parse
   * @param ecosystem Target ecosystem for parsing rules
   */
  export function parse(version: string, ecosystem?: Ecosystem): ParsedVersion;

  /**
   * Try to parse a version, returns null on failure
   */
  export function tryParse(version: string, ecosystem?: Ecosystem): ParsedVersion | null;

  /**
   * Compare two versions
   * @returns -1 if a < b, 0 if a === b, 1 if a > b
   */
  export function compare(a: string, b: string, ecosystem?: Ecosystem): -1 | 0 | 1;

  /**
   * Check if version a is less than b
   */
  export function lt(a: string, b: string, ecosystem?: Ecosystem): boolean;

  /**
   * Check if version a is less than or equal to b
   */
  export function lte(a: string, b: string, ecosystem?: Ecosystem): boolean;

  /**
   * Check if version a is greater than b
   */
  export function gt(a: string, b: string, ecosystem?: Ecosystem): boolean;

  /**
   * Check if version a is greater than or equal to b
   */
  export function gte(a: string, b: string, ecosystem?: Ecosystem): boolean;

  /**
   * Check if two versions are equal
   */
  export function eq(a: string, b: string, ecosystem?: Ecosystem): boolean;

  /**
   * Sort versions (ascending by default)
   */
  export function sort(
    versions: string[],
    ecosystem?: Ecosystem,
    descending?: boolean
  ): string[];

  /**
   * Find the maximum version
   */
  export function max(versions: string[], ecosystem?: Ecosystem): string | null;

  /**
   * Find the minimum version
   */
  export function min(versions: string[], ecosystem?: Ecosystem): string | null;

  /**
   * Check if a version satisfies a range (npm semver range syntax)
   */
  export function satisfies(
    version: string,
    range: string,
    ecosystem?: Ecosystem
  ): boolean;

  /**
   * Find the maximum version that satisfies a range
   */
  export function maxSatisfying(
    versions: string[],
    range: string,
    ecosystem?: Ecosystem
  ): string | null;

  /**
   * Find the minimum version that satisfies a range
   */
  export function minSatisfying(
    versions: string[],
    range: string,
    ecosystem?: Ecosystem
  ): string | null;

  /**
   * Get all versions that satisfy a range
   */
  export function filter(
    versions: string[],
    range: string,
    ecosystem?: Ecosystem
  ): string[];

  /**
   * Check if a string is a valid version
   */
  export function valid(version: string, ecosystem?: Ecosystem): string | null;

  /**
   * Coerce a string to a valid version
   */
  export function coerce(version: string, ecosystem?: Ecosystem): string | null;

  /**
   * Increment version
   */
  export function inc(
    version: string,
    release: 'major' | 'minor' | 'patch' | 'prerelease',
    ecosystem?: Ecosystem,
    identifier?: string
  ): string;

  /**
   * Cache statistics
   */
  export function cacheStats(): {
    size: number;
    hits: number;
    misses: number;
    hitRate: number;
  };

  /**
   * Clear the version cache
   */
  export function clearCache(): void;

  /**
   * Ecosystem constants
   */
  export const ecosystems: {
    readonly NPM: 'npm';
    readonly MAVEN: 'maven';
    readonly PYPI: 'pypi';
    readonly NUGET: 'nuget';
    readonly GEM: 'gem';
    readonly CARGO: 'cargo';
    readonly GOLANG: 'golang';
    readonly COMPOSER: 'composer';
    readonly HEX: 'hex';
    readonly PUB: 'pub';
    readonly SWIFT: 'swift';
  };
}
```

## Ecosystem-Specific Logic

### Maven Version Comparison

```cpp
// Maven uses a complex comparison algorithm
// 1. Tokenize: split on '.', '-', transitions between digits/letters
// 2. Compare tokens pairwise
// 3. Qualifiers have specific ordering

CompareResult CompareMaven(const Version& a, const Version& b) {
  auto tokens_a = maven::Tokenize(a.original);
  auto tokens_b = maven::Tokenize(b.original);

  size_t i = 0;
  while (i < tokens_a.size() || i < tokens_b.size()) {
    auto tok_a = i < tokens_a.size() ? tokens_a[i] : maven::MavenToken{};
    auto tok_b = i < tokens_b.size() ? tokens_b[i] : maven::MavenToken{};

    // Null/empty token handling
    if (tok_a.type == MavenToken::kNumber && tok_b.type == MavenToken::kNumber) {
      if (tok_a.num_value != tok_b.num_value) {
        return tok_a.num_value < tok_b.num_value ?
            CompareResult::kLess : CompareResult::kGreater;
      }
    } else if (tok_a.type == MavenToken::kString || tok_b.type == MavenToken::kString) {
      int rank_a = maven::QualifierRank(tok_a.value);
      int rank_b = maven::QualifierRank(tok_b.value);
      if (rank_a != rank_b) {
        return rank_a < rank_b ? CompareResult::kLess : CompareResult::kGreater;
      }
    }
    i++;
  }

  return CompareResult::kEqual;
}

int maven::QualifierRank(std::string_view q) {
  // Case-insensitive comparison
  std::string lower(q);
  std::transform(lower.begin(), lower.end(), lower.begin(), ::tolower);

  if (lower == "alpha" || lower == "a") return 1;
  if (lower == "beta" || lower == "b") return 2;
  if (lower == "milestone" || lower == "m") return 3;
  if (lower == "rc" || lower == "cr") return 4;
  if (lower == "snapshot") return 5;
  if (lower.empty() || lower == "ga" || lower == "final" || lower == "release") return 6;
  if (lower == "sp") return 7;

  // Unknown qualifiers come after sp
  return 8;
}
```

### PyPI PEP 440 Parsing

```cpp
Version ParsePypi(std::string_view input) {
  Version v;
  v.ecosystem = Ecosystem::kPypi;

  // Handle epoch (N!)
  auto [epoch, rest] = pypi::ParseEpoch(input);
  v.pypi_epoch = epoch;

  // Parse release segment (N.N.N...)
  // Handle pre-release (aN, bN, rcN, alphaN, betaN)
  // Handle post-release (.postN)
  // Handle dev release (.devN)
  // Handle local version (+local)

  // Normalize: convert alpha->a, beta->b, c->rc, preview->rc
  // ...

  return v;
}

std::pair<uint64_t, std::string_view> pypi::ParseEpoch(std::string_view input) {
  auto bang = input.find('!');
  if (bang == std::string_view::npos) {
    return {0, input};
  }

  uint64_t epoch = 0;
  for (size_t i = 0; i < bang; i++) {
    if (!std::isdigit(input[i])) {
      return {0, input};  // Invalid epoch
    }
    epoch = epoch * 10 + (input[i] - '0');
  }

  return {epoch, input.substr(bang + 1)};
}
```

## Test Cases

### `test/parallel/test-smol-versions.js`

```javascript
'use strict';
const common = require('../common');
const assert = require('assert');
const versions = require('node:smol-versions');

// Basic npm/semver parsing
{
  const v = versions.parse('1.2.3', 'npm');
  assert.strictEqual(v.major, 1n);
  assert.strictEqual(v.minor, 2n);
  assert.strictEqual(v.patch, 3n);
}

// Prerelease parsing
{
  const v = versions.parse('1.0.0-alpha.1', 'npm');
  assert.deepStrictEqual(v.prerelease, ['alpha', 1n]);
}

// Build metadata
{
  const v = versions.parse('1.0.0+build.123', 'npm');
  assert.strictEqual(v.buildMetadata, 'build.123');
}

// npm comparison
{
  assert.strictEqual(versions.compare('1.0.0', '2.0.0', 'npm'), -1);
  assert.strictEqual(versions.compare('2.0.0', '1.0.0', 'npm'), 1);
  assert.strictEqual(versions.compare('1.0.0', '1.0.0', 'npm'), 0);

  // Prerelease < release
  assert.strictEqual(versions.compare('1.0.0-alpha', '1.0.0', 'npm'), -1);

  // Numeric vs string prerelease
  assert.strictEqual(versions.compare('1.0.0-1', '1.0.0-alpha', 'npm'), -1);
}

// Maven comparison
{
  // Basic
  assert.strictEqual(versions.compare('1.0', '1.0.0', 'maven'), 0);

  // Qualifiers
  assert.strictEqual(versions.compare('1.0-alpha', '1.0-beta', 'maven'), -1);
  assert.strictEqual(versions.compare('1.0-beta', '1.0-rc', 'maven'), -1);
  assert.strictEqual(versions.compare('1.0-rc', '1.0', 'maven'), -1);
  assert.strictEqual(versions.compare('1.0-SNAPSHOT', '1.0', 'maven'), -1);
  assert.strictEqual(versions.compare('1.0', '1.0-sp', 'maven'), -1);
}

// PyPI PEP 440
{
  // Epoch
  const v = versions.parse('1!2.0.0', 'pypi');
  assert.strictEqual(v.major, 2n);

  // Epoch comparison
  assert.strictEqual(versions.compare('1!1.0.0', '2.0.0', 'pypi'), 1);

  // Prerelease ordering
  assert.strictEqual(versions.compare('1.0.0.dev1', '1.0.0a1', 'pypi'), -1);
  assert.strictEqual(versions.compare('1.0.0a1', '1.0.0b1', 'pypi'), -1);
  assert.strictEqual(versions.compare('1.0.0b1', '1.0.0rc1', 'pypi'), -1);
  assert.strictEqual(versions.compare('1.0.0rc1', '1.0.0', 'pypi'), -1);
  assert.strictEqual(versions.compare('1.0.0', '1.0.0.post1', 'pypi'), -1);
}

// NuGet 4-component
{
  const v = versions.parse('1.2.3.4', 'nuget');
  assert.strictEqual(v.build, 4n);

  assert.strictEqual(versions.compare('1.2.3.4', '1.2.3.5', 'nuget'), -1);
}

// Range matching (npm style)
{
  assert(versions.satisfies('1.2.3', '^1.0.0'));
  assert(versions.satisfies('1.2.3', '~1.2.0'));
  assert(!versions.satisfies('2.0.0', '^1.0.0'));
  assert(versions.satisfies('1.0.0', '>=1.0.0 <2.0.0'));
  assert(versions.satisfies('1.5.0', '1.0.0 - 2.0.0'));
  assert(versions.satisfies('1.2.3', '1.x'));
  assert(versions.satisfies('1.2.3', '1.2.x'));
}

// Sorting
{
  const unsorted = ['1.0.0', '2.0.0', '1.5.0', '0.9.0'];
  const sorted = versions.sort(unsorted, 'npm');
  assert.deepStrictEqual(sorted, ['0.9.0', '1.0.0', '1.5.0', '2.0.0']);

  const desc = versions.sort(unsorted, 'npm', true);
  assert.deepStrictEqual(desc, ['2.0.0', '1.5.0', '1.0.0', '0.9.0']);
}

// Max/min
{
  const vs = ['1.0.0', '2.0.0', '1.5.0'];
  assert.strictEqual(versions.max(vs, 'npm'), '2.0.0');
  assert.strictEqual(versions.min(vs, 'npm'), '1.0.0');
}

// maxSatisfying
{
  const vs = ['1.0.0', '1.5.0', '2.0.0', '2.5.0'];
  assert.strictEqual(versions.maxSatisfying(vs, '^1.0.0'), '1.5.0');
  assert.strictEqual(versions.maxSatisfying(vs, '>=2.0.0'), '2.5.0');
}

// Coercion
{
  assert.strictEqual(versions.coerce('v1.2.3'), '1.2.3');
  assert.strictEqual(versions.coerce('1.2'), '1.2.0');
  assert.strictEqual(versions.coerce('1'), '1.0.0');
}

// Increment
{
  assert.strictEqual(versions.inc('1.2.3', 'major'), '2.0.0');
  assert.strictEqual(versions.inc('1.2.3', 'minor'), '1.3.0');
  assert.strictEqual(versions.inc('1.2.3', 'patch'), '1.2.4');
  assert.strictEqual(versions.inc('1.2.3', 'prerelease', 'npm', 'alpha'), '1.2.4-alpha.0');
}

console.log('All smol-versions tests passed');
```

## Performance Targets (50-100x)

| Operation | Target | JS Baseline | Speedup |
|-----------|--------|-------------|---------|
| Parse | < 15ns | ~1.5µs | **100x** |
| Compare | < 8ns | ~500ns | **60x** |
| Sort (1000) | < 20µs | ~2ms | **100x** |
| Satisfies | < 25ns | ~2µs | **80x** |
| maxSatisfying (100) | < 2µs | ~200µs | **100x** |
| Batch parse (1000) | < 10µs | ~1.5ms | **150x** |

### How We Achieve 100x

1. **Packed 32-byte version struct** - Fits in half a cache line
2. **SIMD digit parsing** - AVX2 parses 8 digits at once
3. **Branchless comparison** - No conditionals in hot path
4. **Pre-computed prerelease ranks** - alpha=1, beta=2, rc=3 as uint8
5. **Lock-free concurrent cache** - No mutex contention
6. **Arena allocation** - Zero malloc in parse loop
7. **Batch SIMD sorting** - Vectorized comparison for sort

## Cross-Platform SIMD Optimizations

### Packed Version Structure (32 bytes)

```cpp
// Cache-line friendly version representation
// Fits 2 versions per cache line for comparison
struct alignas(32) PackedVersion {
  uint64_t major;           // 8 bytes
  uint64_t minor;           // 8 bytes
  uint64_t patch;           // 8 bytes
  uint32_t build;           // 4 bytes (NuGet 4th component)
  uint8_t  prerelease_rank; // 1 byte (0=release, 1=alpha, 2=beta, 3=rc)
  uint8_t  ecosystem;       // 1 byte
  uint8_t  flags;           // 1 byte (has_pre, has_build, valid)
  uint8_t  _pad;            // 1 byte alignment
};
```

### SIMD Digit Parsing (Cross-Platform)

```cpp
#include "smol_simd.h"  // Shared SIMD header

namespace smol {
namespace versions {

// Parse up to 8 digits at once with SIMD
// Input: "1234567" -> Output: 1234567
// Works on all platforms with appropriate fallback

#if SMOL_COMPILE_AVX2
SMOL_FORCE_INLINE uint64_t ParseDigitsAVX2(const char* s, size_t len) {
  if (len == 0 || len > 8) return 0;

  // Load up to 8 characters
  __m128i chunk = _mm_loadl_epi64(reinterpret_cast<const __m128i*>(s));

  // Subtract '0' to get digit values
  __m128i zeros = _mm_set1_epi8('0');
  __m128i digits = _mm_sub_epi8(chunk, zeros);

  // Multiply by position weights: [10000000, 1000000, 100000, ...]
  // Use horizontal add for final result
  // ... (optimized multiplication)

  return result;
}
#endif

#if SMOL_HAS_SSE2
SMOL_FORCE_INLINE uint64_t ParseDigitsSSE2(const char* s, size_t len) {
  if (len == 0) return 0;
  if (len > 19) return UINT64_MAX;  // Overflow

  // SSE2 version - works on all x64 and modern x86
  uint64_t result = 0;
  __m128i zeros = _mm_set1_epi8('0');

  // Process 4 digits at a time
  while (len >= 4) {
    __m128i chunk = _mm_cvtsi32_si128(*reinterpret_cast<const int32_t*>(s));
    __m128i vals = _mm_sub_epi8(chunk, zeros);

    // Extract and combine
    uint32_t v0 = _mm_extract_epi8(vals, 0);
    uint32_t v1 = _mm_extract_epi8(vals, 1);
    uint32_t v2 = _mm_extract_epi8(vals, 2);
    uint32_t v3 = _mm_extract_epi8(vals, 3);

    result = result * 10000 + v0 * 1000 + v1 * 100 + v2 * 10 + v3;
    s += 4;
    len -= 4;
  }

  // Handle remainder
  while (len--) {
    result = result * 10 + (*s++ - '0');
  }
  return result;
}
#endif

#if SMOL_HAS_NEON
SMOL_FORCE_INLINE uint64_t ParseDigitsNEON(const char* s, size_t len) {
  if (len == 0) return 0;

  uint64_t result = 0;
  uint8x8_t zeros = vdup_n_u8('0');

  while (len >= 8) {
    uint8x8_t chunk = vld1_u8(reinterpret_cast<const uint8_t*>(s));
    uint8x8_t vals = vsub_u8(chunk, zeros);

    // Process with widening multiply-add
    uint16x8_t wide = vmovl_u8(vals);
    // ... NEON specific multiply-accumulate

    s += 8;
    len -= 8;
  }

  // Scalar remainder
  while (len--) {
    result = result * 10 + (*s++ - '0');
  }
  return result;
}
#endif

// Scalar fallback
SMOL_FORCE_INLINE uint64_t ParseDigitsScalar(const char* s, size_t len) {
  uint64_t result = 0;
  while (len--) {
    result = result * 10 + (*s++ - '0');
  }
  return result;
}

// Runtime dispatch
inline uint64_t ParseDigits(const char* s, size_t len) {
#if SMOL_COMPILE_AVX2
  if (simd::g_has_avx2 && len <= 8) {
    return ParseDigitsAVX2(s, len);
  }
#endif
#if SMOL_HAS_SSE2
  return ParseDigitsSSE2(s, len);
#elif SMOL_HAS_NEON
  return ParseDigitsNEON(s, len);
#else
  return ParseDigitsScalar(s, len);
#endif
}

}  // namespace versions
}  // namespace smol
```

### Branchless Version Comparison

```cpp
// Compare two packed versions without branches
// Returns: -1, 0, or 1
SMOL_FORCE_INLINE int CompareVersionsBranchless(
    const PackedVersion& a, const PackedVersion& b) {
  // Compare major.minor.patch as single comparison where possible
  // Using subtraction and sign extraction

  // Major comparison
  int64_t diff = static_cast<int64_t>(a.major) - static_cast<int64_t>(b.major);
  if (diff) return (diff > 0) - (diff < 0);

  // Minor
  diff = static_cast<int64_t>(a.minor) - static_cast<int64_t>(b.minor);
  if (diff) return (diff > 0) - (diff < 0);

  // Patch
  diff = static_cast<int64_t>(a.patch) - static_cast<int64_t>(b.patch);
  if (diff) return (diff > 0) - (diff < 0);

  // Prerelease: release (0) > prerelease (1,2,3)
  // But alpha(1) < beta(2) < rc(3)
  uint8_t a_pre = a.prerelease_rank;
  uint8_t b_pre = b.prerelease_rank;

  // Both release
  if ((a_pre | b_pre) == 0) return 0;

  // One is release (rank 0), one is prerelease
  if (a_pre == 0) return 1;   // a is release, b is prerelease
  if (b_pre == 0) return -1;  // b is release, a is prerelease

  // Both prerelease - compare ranks
  return (a_pre > b_pre) - (a_pre < b_pre);
}

// SIMD batch comparison for sorting
#if SMOL_HAS_SSE2
void CompareVersionBatchSSE2(
    const PackedVersion* versions,
    size_t count,
    const PackedVersion& pivot,
    int8_t* results) {
  // Compare 4 versions at once against pivot
  // ... SSE2 implementation
}
#endif
```

### Lock-Free LRU Cache

```cpp
#include <atomic>

// Lock-free version cache using atomic operations
class VersionCache {
 public:
  static constexpr size_t kCapacity = 65536;  // Power of 2 for fast modulo

  struct Entry {
    std::atomic<uint64_t> hash{0};
    PackedVersion version;
    char key[64];  // Inline key storage
  };

  const PackedVersion* Get(std::string_view key) {
    uint64_t h = Hash(key);
    size_t idx = h & (kCapacity - 1);

    // Linear probe
    for (size_t i = 0; i < 8; i++) {
      Entry& e = entries_[(idx + i) & (kCapacity - 1)];
      if (e.hash.load(std::memory_order_acquire) == h) {
        // Verify key matches
        if (std::string_view(e.key) == key) {
          hits_.fetch_add(1, std::memory_order_relaxed);
          return &e.version;
        }
      }
    }
    misses_.fetch_add(1, std::memory_order_relaxed);
    return nullptr;
  }

  void Put(std::string_view key, const PackedVersion& version) {
    uint64_t h = Hash(key);
    size_t idx = h & (kCapacity - 1);

    // Find empty or matching slot
    for (size_t i = 0; i < 8; i++) {
      Entry& e = entries_[(idx + i) & (kCapacity - 1)];
      uint64_t expected = 0;
      if (e.hash.compare_exchange_strong(expected, h,
              std::memory_order_acq_rel)) {
        // Got empty slot
        memcpy(e.key, key.data(), std::min(key.size(), size_t{63}));
        e.key[std::min(key.size(), size_t{63})] = '\0';
        e.version = version;
        return;
      }
    }
    // Cache full - could implement eviction here
  }

 private:
  static uint64_t Hash(std::string_view s) {
    // FNV-1a
    uint64_t h = 14695981039346656037ull;
    for (char c : s) {
      h ^= static_cast<uint8_t>(c);
      h *= 1099511628211ull;
    }
    return h | 1;  // Ensure non-zero
  }

  alignas(64) Entry entries_[kCapacity];
  std::atomic<uint64_t> hits_{0};
  std::atomic<uint64_t> misses_{0};
};
```

## Build Configuration

### `smol_versions.gypi`

```python
{
  'targets': [
    {
      'target_name': 'smol_versions',
      'type': 'static_library',
      'sources': [
        'smol_versions_binding.cc',
        'smol_versions_npm.cc',
        'smol_versions_maven.cc',
        'smol_versions_pypi.cc',
        'smol_versions_v8_binding.cc',
      ],
      'include_dirs': [
        '.',
        '<(node_root_dir)/src',
        '<(node_root_dir)/deps/v8/include',
      ],
      'defines': [
        'NODE_WANT_INTERNALS=1',
      ],
      'conditions': [
        # Windows
        ['OS=="win"', {
          'msvs_settings': {
            'VCCLCompilerTool': {
              'AdditionalOptions': ['/std:c++17'],
              'EnableEnhancedInstructionSet': '2',  # SSE2
            },
          },
        }],
        # macOS
        ['OS=="mac"', {
          'xcode_settings': {
            'CLANG_CXX_LANGUAGE_STANDARD': 'c++17',
            'OTHER_CPLUSPLUSFLAGS': ['-fno-exceptions'],
          },
          'conditions': [
            ['target_arch=="x64"', {
              'xcode_settings': {
                'OTHER_CPLUSPLUSFLAGS': ['-msse4.2', '-mavx2'],
              },
            }],
            ['target_arch=="arm64"', {
              'xcode_settings': {
                'OTHER_CPLUSPLUSFLAGS': ['-march=armv8-a+simd'],
              },
            }],
          ],
        }],
        # Linux
        ['OS=="linux"', {
          'cflags_cc': ['-std=c++17', '-fno-exceptions'],
          'conditions': [
            ['target_arch=="x64"', {
              'cflags_cc': ['-msse2', '-msse4.2'],
            }],
            ['target_arch=="arm64"', {
              'cflags_cc': ['-march=armv8-a+simd'],
            }],
          ],
        }],
      ],
    },
  ],
}
```

## Implementation Phases

### Phase 1: Core npm/SemVer
- Parse SemVer 2.0 versions
- Basic comparison
- Range matching (^, ~, =, >, <, etc.)
- V8 bindings

### Phase 2: Multi-Ecosystem
- Maven version parsing and comparison
- PyPI PEP 440 support
- NuGet 4-component support
- Cargo strict semver

### Phase 3: Performance
- LRU caching
- Batch operations
- SIMD where applicable

### Phase 4: Advanced Features
- Complex range expressions
- Coercion
- Version incrementing

## Migration Path

### From node-semver

```javascript
// Before
const semver = require('semver');
if (semver.satisfies(version, '^1.0.0')) { ... }
const sorted = semver.sort(versions);

// After
const versions = require('node:smol-versions');
if (versions.satisfies(version, '^1.0.0', 'npm')) { ... }
const sorted = versions.sort(vers, 'npm');
```

### From coana-package-manager

```javascript
// Before (internal compare functions)
import { compareNpmVersions } from './compare/npm';
const result = compareNpmVersions(a, b);

// After
import versions from 'node:smol-versions';
const result = versions.compare(a, b, 'npm');
```
