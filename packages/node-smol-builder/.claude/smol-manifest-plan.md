# smol-manifest Implementation Plan

## Overview

`node:smol-manifest` provides high-performance parsing for package manifests (package.json, pom.xml, pyproject.toml, etc.) and lockfiles (package-lock.json, yarn.lock, pnpm-lock.yaml, etc.). Uses simdjson/rapidyaml for blazing-fast parsing. Target: **50-100x faster** than JavaScript implementations.

## Performance Strategy for 50-100x

### Key Optimizations
1. **simdjson SIMD parsing** - 2.5GB/s JSON parsing with AVX2/NEON
2. **Memory-mapped files** - Zero-copy for large lockfiles (100MB+)
3. **On-demand parsing** - Only parse fields that are accessed
4. **Pre-computed hash index** - O(1) package lookup in lockfiles
5. **String interning** - Deduplicate repeated package names
6. **Arena allocation** - Single allocation for entire parse result
7. **Streaming for huge files** - Constant memory for any file size

## Reference Implementations

Based on analysis of:
- `socket-sbom-generator/src/parsers/` - Lockfile parsing
- `coana-package-manager/src/parse/` - Manifest parsing
- `patch-cli` - Package manifest handling

## Supported Formats

### Manifests
| Format | File | Ecosystem |
|--------|------|-----------|
| package.json | package.json | npm |
| pom.xml | pom.xml | Maven |
| pyproject.toml | pyproject.toml | PyPI |
| setup.py | setup.py | PyPI (legacy) |
| Cargo.toml | Cargo.toml | Cargo |
| Gemfile | Gemfile | RubyGems |
| go.mod | go.mod | Go |
| composer.json | composer.json | Composer |
| *.csproj | *.csproj | NuGet |

### Lockfiles
| Format | File | Ecosystem |
|--------|------|-----------|
| package-lock.json | package-lock.json | npm v2/v3 |
| npm-shrinkwrap.json | npm-shrinkwrap.json | npm |
| yarn.lock | yarn.lock | Yarn v1/v2/v3 |
| pnpm-lock.yaml | pnpm-lock.yaml | pnpm |
| Cargo.lock | Cargo.lock | Cargo |
| Gemfile.lock | Gemfile.lock | RubyGems |
| poetry.lock | poetry.lock | Poetry |
| go.sum | go.sum | Go |
| composer.lock | composer.lock | Composer |

## C++ Architecture

### Header: `smol_manifest_binding.h`

```cpp
#ifndef SRC_SMOL_MANIFEST_BINDING_H_
#define SRC_SMOL_MANIFEST_BINDING_H_

#include <string>
#include <string_view>
#include <vector>
#include <unordered_map>
#include <optional>
#include <variant>
#include <memory>

// Forward declarations
namespace simdjson { class ondemand; }

namespace node {
namespace smol_manifest {

// Ecosystem enum
enum class Ecosystem : uint8_t {
  kNpm = 0,
  kMaven = 1,
  kPypi = 2,
  kCargo = 3,
  kGem = 4,
  kGolang = 5,
  kComposer = 6,
  kNuget = 7,
};

// Dependency type
enum class DepType : uint8_t {
  kProd = 0,
  kDev = 1,
  kOptional = 2,
  kPeer = 3,
  kBuild = 4,
  kTest = 5,
};

// Package reference in lockfile
struct PackageRef {
  std::string_view name;
  std::string_view version;
  std::string_view resolved;  // URL or path
  std::string_view integrity; // sha512/sha1 hash
  Ecosystem ecosystem;
  DepType dep_type;

  // Dependencies of this package
  std::vector<std::pair<std::string_view, std::string_view>> deps;
};

// Dependency declaration in manifest
struct Dependency {
  std::string_view name;
  std::string_view version_range;
  DepType type;
  bool optional;
};

// Parsed manifest
struct Manifest {
  std::string_view name;
  std::string_view version;
  std::string_view description;
  std::string_view license;
  std::string_view repository;

  std::vector<Dependency> dependencies;

  Ecosystem ecosystem;
  bool valid = false;
  const char* error = nullptr;

  // Keep source alive
  std::string source;
};

// Parsed lockfile
struct Lockfile {
  std::string_view lock_version;
  Ecosystem ecosystem;

  std::vector<PackageRef> packages;

  // Package index by name for O(1) lookup
  std::unordered_map<std::string_view, size_t> package_index;

  bool valid = false;
  const char* error = nullptr;

  // Keep source alive
  std::string source;
};

// High-performance JSON parser using simdjson
class JsonParser {
 public:
  // Parse package.json
  static Manifest ParsePackageJson(std::string_view content);

  // Parse package-lock.json (npm v2/v3)
  static Lockfile ParsePackageLock(std::string_view content);

  // Parse composer.json
  static Manifest ParseComposerJson(std::string_view content);

  // Parse composer.lock
  static Lockfile ParseComposerLock(std::string_view content);

 private:
  // simdjson parser instance (thread-local)
  static thread_local simdjson::ondemand::parser parser_;
};

// YAML parser using rapidyaml
class YamlParser {
 public:
  // Parse pnpm-lock.yaml
  static Lockfile ParsePnpmLock(std::string_view content);

  // Parse pubspec.yaml
  static Manifest ParsePubspec(std::string_view content);

 private:
  // rapidyaml tree
};

// TOML parser
class TomlParser {
 public:
  // Parse Cargo.toml
  static Manifest ParseCargoToml(std::string_view content);

  // Parse Cargo.lock
  static Lockfile ParseCargoLock(std::string_view content);

  // Parse pyproject.toml
  static Manifest ParsePyproject(std::string_view content);

  // Parse poetry.lock
  static Lockfile ParsePoetryLock(std::string_view content);
};

// Custom format parsers
class CustomParser {
 public:
  // Parse yarn.lock (custom format)
  static Lockfile ParseYarnLock(std::string_view content);

  // Parse Gemfile.lock
  static Lockfile ParseGemfileLock(std::string_view content);

  // Parse go.sum
  static Lockfile ParseGoSum(std::string_view content);

  // Parse go.mod
  static Manifest ParseGoMod(std::string_view content);

  // Parse pom.xml
  static Manifest ParsePomXml(std::string_view content);
};

// Unified parsing interface
class ManifestParser {
 public:
  // Auto-detect format from filename
  static std::variant<Manifest, Lockfile> Parse(
      std::string_view filename,
      std::string_view content);

  // Parse with explicit format
  static Manifest ParseManifest(
      std::string_view content,
      Ecosystem ecosystem);

  static Lockfile ParseLockfile(
      std::string_view content,
      Ecosystem ecosystem,
      const char* format = nullptr);  // e.g., "yarn-v1", "yarn-berry"

  // Streaming parser for large lockfiles
  class StreamingLockfileParser {
   public:
    explicit StreamingLockfileParser(
        std::string_view content,
        Ecosystem ecosystem);

    // Iterator interface
    bool HasNext() const;
    PackageRef Next();

    // Get total count (if available from header)
    std::optional<size_t> TotalCount() const;

   private:
    // Internal state
  };
};

// Lockfile statistics
struct LockfileStats {
  size_t total_packages;
  size_t prod_deps;
  size_t dev_deps;
  size_t optional_deps;

  // By ecosystem breakdown
  std::unordered_map<std::string, size_t> by_ecosystem;

  // Depth analysis
  size_t max_depth;
  double avg_depth;
};

LockfileStats AnalyzeLockfile(const Lockfile& lock);

}  // namespace smol_manifest
}  // namespace node

#endif  // SRC_SMOL_MANIFEST_BINDING_H_
```

### simdjson Integration

```cpp
// smol_manifest_json.cc
#include "smol_manifest_binding.h"
#include "simdjson.h"

namespace node {
namespace smol_manifest {

using namespace simdjson;

thread_local ondemand::parser JsonParser::parser_;

Manifest JsonParser::ParsePackageJson(std::string_view content) {
  Manifest result;
  result.ecosystem = Ecosystem::kNpm;

  // Pad content for simdjson (requires SIMDJSON_PADDING)
  padded_string padded(content);

  ondemand::document doc;
  auto error = parser_.iterate(padded).get(doc);
  if (error) {
    result.error = "Failed to parse JSON";
    return result;
  }

  // Extract name
  std::string_view name;
  if (!doc["name"].get_string().get(name)) {
    result.name = name;
  }

  // Extract version
  std::string_view version;
  if (!doc["version"].get_string().get(version)) {
    result.version = version;
  }

  // Parse dependencies
  auto parse_deps = [&](const char* field, DepType type) {
    ondemand::object deps_obj;
    if (doc[field].get_object().get(deps_obj)) return;

    for (auto field : deps_obj) {
      std::string_view dep_name, dep_version;
      if (field.unescaped_key().get(dep_name)) continue;
      if (field.value().get_string().get(dep_version)) continue;

      result.dependencies.push_back({
        .name = dep_name,
        .version_range = dep_version,
        .type = type,
        .optional = false,
      });
    }
  };

  parse_deps("dependencies", DepType::kProd);
  parse_deps("devDependencies", DepType::kDev);
  parse_deps("peerDependencies", DepType::kPeer);
  parse_deps("optionalDependencies", DepType::kOptional);

  result.valid = true;
  return result;
}

Lockfile JsonParser::ParsePackageLock(std::string_view content) {
  Lockfile result;
  result.ecosystem = Ecosystem::kNpm;

  padded_string padded(content);

  ondemand::document doc;
  auto error = parser_.iterate(padded).get(doc);
  if (error) {
    result.error = "Failed to parse JSON";
    return result;
  }

  // Check lockfile version
  int64_t lock_version;
  if (!doc["lockfileVersion"].get_int64().get(lock_version)) {
    result.lock_version = lock_version == 3 ? "3" :
                          lock_version == 2 ? "2" : "1";
  }

  // Parse packages (v2/v3 format)
  ondemand::object packages;
  if (!doc["packages"].get_object().get(packages)) {
    for (auto entry : packages) {
      std::string_view path;
      if (entry.unescaped_key().get(path)) continue;

      // Skip root package (empty string key)
      if (path.empty()) continue;

      ondemand::object pkg;
      if (entry.value().get_object().get(pkg)) continue;

      PackageRef ref;

      // Extract name from path (node_modules/name or node_modules/@scope/name)
      auto last_nm = path.rfind("node_modules/");
      if (last_nm != std::string_view::npos) {
        ref.name = path.substr(last_nm + 13);
      }

      std::string_view version;
      if (!pkg["version"].get_string().get(version)) {
        ref.version = version;
      }

      std::string_view resolved;
      if (!pkg["resolved"].get_string().get(resolved)) {
        ref.resolved = resolved;
      }

      std::string_view integrity;
      if (!pkg["integrity"].get_string().get(integrity)) {
        ref.integrity = integrity;
      }

      // Check if dev dependency
      bool dev = false;
      pkg["dev"].get_bool().get(dev);
      ref.dep_type = dev ? DepType::kDev : DepType::kProd;

      ref.ecosystem = Ecosystem::kNpm;
      result.packages.push_back(std::move(ref));
    }
  }

  // Build index
  for (size_t i = 0; i < result.packages.size(); i++) {
    result.package_index[result.packages[i].name] = i;
  }

  result.valid = true;
  return result;
}

}  // namespace smol_manifest
}  // namespace node
```

### Yarn.lock Parser (Custom Format)

```cpp
// smol_manifest_yarn.cc
#include "smol_manifest_binding.h"

namespace node {
namespace smol_manifest {

// Yarn.lock format:
// "package@version":
//   version "x.y.z"
//   resolved "url"
//   integrity sha512-...
//   dependencies:
//     dep1 "^1.0.0"

Lockfile CustomParser::ParseYarnLock(std::string_view content) {
  Lockfile result;
  result.ecosystem = Ecosystem::kNpm;

  // Detect version (v1 vs berry)
  bool is_berry = content.substr(0, 100).find("__metadata") != std::string_view::npos;
  result.lock_version = is_berry ? "berry" : "1";

  size_t pos = 0;
  while (pos < content.size()) {
    // Skip comments and whitespace
    if (content[pos] == '#' || content[pos] == '\n') {
      pos = content.find('\n', pos);
      if (pos == std::string_view::npos) break;
      pos++;
      continue;
    }

    // Find package declaration (starts at column 0, ends with :)
    if (content[pos] == '"' || std::isalnum(content[pos]) || content[pos] == '@') {
      auto line_end = content.find('\n', pos);
      auto colon = content.rfind(':', line_end);

      if (colon != std::string_view::npos && colon > pos) {
        // Parse package name and version spec
        auto spec = content.substr(pos, colon - pos);

        PackageRef ref;
        ref.ecosystem = Ecosystem::kNpm;

        // Extract name (before @version or before comma)
        // Handle: "name@version", "@scope/name@version", "name@v1, name@v2"
        ParseYarnPackageSpec(spec, ref);

        // Parse indented properties
        pos = line_end + 1;
        while (pos < content.size() &&
               (content[pos] == ' ' || content[pos] == '\t')) {
          auto prop_end = content.find('\n', pos);
          auto prop_line = content.substr(pos, prop_end - pos);

          // Skip leading whitespace
          size_t prop_start = prop_line.find_first_not_of(" \t");
          if (prop_start == std::string_view::npos) {
            pos = prop_end + 1;
            continue;
          }
          prop_line = prop_line.substr(prop_start);

          // Parse property
          if (prop_line.starts_with("version ")) {
            ref.version = ExtractQuoted(prop_line.substr(8));
          } else if (prop_line.starts_with("resolved ")) {
            ref.resolved = ExtractQuoted(prop_line.substr(9));
          } else if (prop_line.starts_with("integrity ")) {
            ref.integrity = ExtractQuoted(prop_line.substr(10));
          }

          pos = prop_end + 1;
        }

        result.packages.push_back(std::move(ref));
        continue;
      }
    }

    pos++;
  }

  // Build index
  for (size_t i = 0; i < result.packages.size(); i++) {
    result.package_index[result.packages[i].name] = i;
  }

  result.valid = true;
  return result;
}

}  // namespace smol_manifest
}  // namespace node
```

### YAML Parser (pnpm-lock)

```cpp
// smol_manifest_yaml.cc
#include "smol_manifest_binding.h"
#include "ryml.hpp"  // rapidyaml

namespace node {
namespace smol_manifest {

Lockfile YamlParser::ParsePnpmLock(std::string_view content) {
  Lockfile result;
  result.ecosystem = Ecosystem::kNpm;

  // Parse with rapidyaml (much faster than js-yaml)
  ryml::Tree tree = ryml::parse_in_arena(
      ryml::csubstr(content.data(), content.size()));

  ryml::ConstNodeRef root = tree.rootref();

  // Get lockfile version
  if (root.has_child("lockfileVersion")) {
    auto lv = root["lockfileVersion"];
    if (lv.is_keyval()) {
      result.lock_version = std::string(lv.val().str, lv.val().len);
    }
  }

  // Parse packages (pnpm v6+ format)
  if (root.has_child("packages")) {
    auto packages = root["packages"];

    for (auto pkg : packages) {
      PackageRef ref;
      ref.ecosystem = Ecosystem::kNpm;

      // Package key is like /package@version or /@scope/package@version
      std::string_view key(pkg.key().str, pkg.key().len);
      ParsePnpmPackageKey(key, ref);

      // Parse properties
      if (pkg.has_child("resolution")) {
        auto res = pkg["resolution"];
        if (res.has_child("integrity")) {
          auto integ = res["integrity"];
          ref.integrity = std::string_view(integ.val().str, integ.val().len);
        }
      }

      if (pkg.has_child("dev")) {
        auto dev = pkg["dev"];
        if (dev.val() == "true") {
          ref.dep_type = DepType::kDev;
        }
      }

      result.packages.push_back(std::move(ref));
    }
  }

  // Build index
  for (size_t i = 0; i < result.packages.size(); i++) {
    result.package_index[result.packages[i].name] = i;
  }

  result.valid = true;
  return result;
}

}  // namespace smol_manifest
}  // namespace node
```

## V8 Binding

```cpp
// smol_manifest_v8_binding.cc
#include "smol_manifest_binding.h"
#include "env-inl.h"
#include "node_internals.h"
#include "v8.h"

namespace node {
namespace smol_manifest {

using v8::Array;
using v8::Context;
using v8::FunctionCallbackInfo;
using v8::Isolate;
using v8::Local;
using v8::Object;
using v8::String;
using v8::Value;

void ParseManifest(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();

  if (args.Length() < 2) {
    isolate->ThrowException(v8::Exception::TypeError(
        String::NewFromUtf8Literal(isolate, "Expected filename and content")));
    return;
  }

  v8::String::Utf8Value filename(isolate, args[0]);
  v8::String::Utf8Value content(isolate, args[1]);

  auto result = ManifestParser::Parse(
      std::string_view(*filename, filename.length()),
      std::string_view(*content, content.length()));

  if (std::holds_alternative<Manifest>(result)) {
    const auto& manifest = std::get<Manifest>(result);
    if (!manifest.valid) {
      isolate->ThrowException(v8::Exception::Error(
          String::NewFromUtf8(isolate, manifest.error).ToLocalChecked()));
      return;
    }

    Local<Object> obj = Object::New(isolate);
    obj->Set(context,
        String::NewFromUtf8Literal(isolate, "type"),
        String::NewFromUtf8Literal(isolate, "manifest")).Check();

    obj->Set(context,
        String::NewFromUtf8Literal(isolate, "name"),
        String::NewFromUtf8(isolate, manifest.name.data(),
            v8::NewStringType::kNormal, manifest.name.length())
            .ToLocalChecked()).Check();

    // ... set other properties

    // Build dependencies array
    Local<Array> deps = Array::New(isolate, manifest.dependencies.size());
    for (size_t i = 0; i < manifest.dependencies.size(); i++) {
      const auto& dep = manifest.dependencies[i];
      Local<Object> dep_obj = Object::New(isolate);
      dep_obj->Set(context,
          String::NewFromUtf8Literal(isolate, "name"),
          String::NewFromUtf8(isolate, dep.name.data(),
              v8::NewStringType::kNormal, dep.name.length())
              .ToLocalChecked()).Check();
      // ... version, type, etc.
      deps->Set(context, i, dep_obj).Check();
    }
    obj->Set(context, String::NewFromUtf8Literal(isolate, "dependencies"), deps).Check();

    args.GetReturnValue().Set(obj);
  } else {
    // Handle Lockfile
    // Similar structure with packages array
  }
}

// Streaming parser for large lockfiles
void CreateStreamingParser(const FunctionCallbackInfo<Value>& args) {
  // Returns an object with next() method
}

void Initialize(Local<Object> target,
                Local<Value> unused,
                Local<Context> context,
                void* priv) {
  Environment* env = Environment::GetCurrent(context);

  env->SetMethod(target, "parse", ParseManifest);
  env->SetMethod(target, "parseManifest", ParseManifestOnly);
  env->SetMethod(target, "parseLockfile", ParseLockfileOnly);
  env->SetMethod(target, "createStreamingParser", CreateStreamingParser);
  env->SetMethod(target, "analyzeLockfile", AnalyzeLockfileJS);
}

NODE_MODULE_CONTEXT_AWARE_INTERNAL(smol_manifest, Initialize)

}  // namespace smol_manifest
}  // namespace node
```

## TypeScript Interface

### `lib/internal/smol_manifest.d.ts`

```typescript
declare module 'node:smol-manifest' {
  export type Ecosystem =
    | 'npm' | 'maven' | 'pypi' | 'cargo' | 'gem'
    | 'golang' | 'composer' | 'nuget';

  export type DepType =
    | 'prod' | 'dev' | 'optional' | 'peer' | 'build' | 'test';

  export interface Dependency {
    readonly name: string;
    readonly versionRange: string;
    readonly type: DepType;
    readonly optional: boolean;
  }

  export interface Manifest {
    readonly type: 'manifest';
    readonly name: string;
    readonly version: string;
    readonly description?: string;
    readonly license?: string;
    readonly repository?: string;
    readonly dependencies: ReadonlyArray<Dependency>;
    readonly ecosystem: Ecosystem;
  }

  export interface PackageRef {
    readonly name: string;
    readonly version: string;
    readonly resolved?: string;
    readonly integrity?: string;
    readonly ecosystem: Ecosystem;
    readonly depType: DepType;
    readonly dependencies?: ReadonlyArray<{ name: string; range: string }>;
  }

  export interface Lockfile {
    readonly type: 'lockfile';
    readonly lockVersion: string;
    readonly ecosystem: Ecosystem;
    readonly packages: ReadonlyArray<PackageRef>;
  }

  export interface LockfileStats {
    readonly totalPackages: number;
    readonly prodDeps: number;
    readonly devDeps: number;
    readonly optionalDeps: number;
    readonly byEcosystem: Readonly<Record<string, number>>;
    readonly maxDepth: number;
    readonly avgDepth: number;
  }

  /**
   * Parse a manifest or lockfile (auto-detect from filename)
   */
  export function parse(filename: string, content: string): Manifest | Lockfile;

  /**
   * Parse a package manifest
   */
  export function parseManifest(content: string, ecosystem: Ecosystem): Manifest;

  /**
   * Parse a lockfile
   * @param format Optional format hint (e.g., 'yarn-v1', 'yarn-berry')
   */
  export function parseLockfile(
    content: string,
    ecosystem: Ecosystem,
    format?: string
  ): Lockfile;

  /**
   * Create a streaming parser for large lockfiles
   */
  export function createStreamingParser(
    content: string,
    ecosystem: Ecosystem
  ): AsyncIterable<PackageRef>;

  /**
   * Analyze lockfile statistics
   */
  export function analyzeLockfile(lockfile: Lockfile): LockfileStats;

  /**
   * Get package by name from lockfile (O(1) lookup)
   */
  export function getPackage(lockfile: Lockfile, name: string): PackageRef | null;

  /**
   * Get all packages matching a pattern
   */
  export function findPackages(
    lockfile: Lockfile,
    pattern: string | RegExp
  ): PackageRef[];

  /**
   * Detect file format from filename
   */
  export function detectFormat(filename: string): {
    type: 'manifest' | 'lockfile';
    ecosystem: Ecosystem;
    format?: string;
  } | null;

  /**
   * Supported file patterns
   */
  export const supportedFiles: {
    readonly manifests: ReadonlyArray<string>;
    readonly lockfiles: ReadonlyArray<string>;
  };
}
```

## JavaScript Wrapper

### `lib/internal/smol_manifest.js`

```javascript
'use strict';

const binding = internalBinding('smol_manifest');

// File detection patterns
const MANIFEST_PATTERNS = {
  'package.json': { ecosystem: 'npm' },
  'pom.xml': { ecosystem: 'maven' },
  'pyproject.toml': { ecosystem: 'pypi' },
  'setup.py': { ecosystem: 'pypi' },
  'Cargo.toml': { ecosystem: 'cargo' },
  'Gemfile': { ecosystem: 'gem' },
  'go.mod': { ecosystem: 'golang' },
  'composer.json': { ecosystem: 'composer' },
};

const LOCKFILE_PATTERNS = {
  'package-lock.json': { ecosystem: 'npm', format: 'npm-v2' },
  'npm-shrinkwrap.json': { ecosystem: 'npm', format: 'npm-v2' },
  'yarn.lock': { ecosystem: 'npm', format: 'yarn' },
  'pnpm-lock.yaml': { ecosystem: 'npm', format: 'pnpm' },
  'Cargo.lock': { ecosystem: 'cargo', format: 'cargo' },
  'Gemfile.lock': { ecosystem: 'gem', format: 'bundler' },
  'poetry.lock': { ecosystem: 'pypi', format: 'poetry' },
  'go.sum': { ecosystem: 'golang', format: 'go' },
  'composer.lock': { ecosystem: 'composer', format: 'composer' },
};

function detectFormat(filename) {
  const basename = filename.split('/').pop();

  if (MANIFEST_PATTERNS[basename]) {
    return { type: 'manifest', ...MANIFEST_PATTERNS[basename] };
  }
  if (LOCKFILE_PATTERNS[basename]) {
    return { type: 'lockfile', ...LOCKFILE_PATTERNS[basename] };
  }

  // Check patterns (*.csproj, etc.)
  if (basename.endsWith('.csproj')) {
    return { type: 'manifest', ecosystem: 'nuget' };
  }

  return null;
}

function parse(filename, content) {
  const format = detectFormat(filename);
  if (!format) {
    throw new Error(`Unknown file format: ${filename}`);
  }

  const result = binding.parse(filename, content);
  return Object.freeze(result);
}

function parseManifest(content, ecosystem) {
  return Object.freeze(binding.parseManifest(content, ecosystem));
}

function parseLockfile(content, ecosystem, format) {
  return Object.freeze(binding.parseLockfile(content, ecosystem, format));
}

async function* createStreamingParser(content, ecosystem) {
  const parser = binding.createStreamingParser(content, ecosystem);
  while (parser.hasNext()) {
    yield parser.next();
  }
}

function analyzeLockfile(lockfile) {
  return binding.analyzeLockfile(lockfile);
}

function getPackage(lockfile, name) {
  // Use the pre-built index for O(1) lookup
  const index = lockfile._index || buildIndex(lockfile);
  const idx = index[name];
  return idx !== undefined ? lockfile.packages[idx] : null;
}

function findPackages(lockfile, pattern) {
  const regex = pattern instanceof RegExp ? pattern : new RegExp(pattern);
  return lockfile.packages.filter(pkg => regex.test(pkg.name));
}

const supportedFiles = Object.freeze({
  manifests: Object.freeze(Object.keys(MANIFEST_PATTERNS)),
  lockfiles: Object.freeze(Object.keys(LOCKFILE_PATTERNS)),
});

module.exports = {
  parse,
  parseManifest,
  parseLockfile,
  createStreamingParser,
  analyzeLockfile,
  getPackage,
  findPackages,
  detectFormat,
  supportedFiles,
};
```

## Test Cases

### `test/parallel/test-smol-manifest.js`

```javascript
'use strict';
const common = require('../common');
const assert = require('assert');
const manifest = require('node:smol-manifest');

// package.json parsing
{
  const content = JSON.stringify({
    name: 'test-pkg',
    version: '1.0.0',
    dependencies: { lodash: '^4.0.0' },
    devDependencies: { jest: '^29.0.0' },
  });

  const result = manifest.parse('package.json', content);
  assert.strictEqual(result.type, 'manifest');
  assert.strictEqual(result.name, 'test-pkg');
  assert.strictEqual(result.version, '1.0.0');
  assert.strictEqual(result.dependencies.length, 2);

  const lodash = result.dependencies.find(d => d.name === 'lodash');
  assert.strictEqual(lodash.type, 'prod');
  assert.strictEqual(lodash.versionRange, '^4.0.0');
}

// package-lock.json parsing
{
  const content = JSON.stringify({
    lockfileVersion: 3,
    packages: {
      '': { name: 'test-pkg', version: '1.0.0' },
      'node_modules/lodash': {
        version: '4.17.21',
        resolved: 'https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz',
        integrity: 'sha512-v2kDE...',
      },
    },
  });

  const result = manifest.parse('package-lock.json', content);
  assert.strictEqual(result.type, 'lockfile');
  assert.strictEqual(result.lockVersion, '3');
  assert.strictEqual(result.packages.length, 1); // Excludes root

  const pkg = manifest.getPackage(result, 'lodash');
  assert.strictEqual(pkg.version, '4.17.21');
}

// yarn.lock parsing
{
  const content = `
# yarn lockfile v1

lodash@^4.0.0:
  version "4.17.21"
  resolved "https://registry.yarnpkg.com/lodash/-/lodash-4.17.21.tgz"
  integrity sha512-v2kDE...
`;

  const result = manifest.parse('yarn.lock', content);
  assert.strictEqual(result.type, 'lockfile');
  assert.strictEqual(result.lockVersion, '1');

  const pkg = manifest.getPackage(result, 'lodash');
  assert.strictEqual(pkg.version, '4.17.21');
}

// pnpm-lock.yaml parsing
{
  const content = `
lockfileVersion: '6.0'

packages:
  /lodash@4.17.21:
    resolution: {integrity: sha512-v2kDE...}
    dev: false
`;

  const result = manifest.parse('pnpm-lock.yaml', content);
  assert.strictEqual(result.type, 'lockfile');

  const pkg = manifest.getPackage(result, 'lodash');
  assert.strictEqual(pkg.version, '4.17.21');
  assert.strictEqual(pkg.depType, 'prod');
}

// Cargo.toml parsing
{
  const content = `
[package]
name = "my-crate"
version = "0.1.0"

[dependencies]
serde = "1.0"
tokio = { version = "1.0", features = ["full"] }

[dev-dependencies]
criterion = "0.4"
`;

  const result = manifest.parse('Cargo.toml', content);
  assert.strictEqual(result.type, 'manifest');
  assert.strictEqual(result.name, 'my-crate');
  assert.strictEqual(result.ecosystem, 'cargo');

  const serde = result.dependencies.find(d => d.name === 'serde');
  assert.strictEqual(serde.versionRange, '1.0');
}

// Lockfile analysis
{
  const lockfile = manifest.parseLockfile(largePackageLock, 'npm');
  const stats = manifest.analyzeLockfile(lockfile);

  assert(stats.totalPackages > 0);
  assert(stats.maxDepth >= 0);
  assert(stats.avgDepth >= 0);
}

// Format detection
{
  assert.deepStrictEqual(manifest.detectFormat('package.json'), {
    type: 'manifest',
    ecosystem: 'npm',
  });

  assert.deepStrictEqual(manifest.detectFormat('yarn.lock'), {
    type: 'lockfile',
    ecosystem: 'npm',
    format: 'yarn',
  });

  assert.strictEqual(manifest.detectFormat('unknown.txt'), null);
}

console.log('All smol-manifest tests passed');
```

## Performance Targets (50-100x)

| Operation | Target | JS Baseline | Speedup |
|-----------|--------|-------------|---------|
| package.json (1KB) | < 2µs | ~200µs | **100x** |
| package-lock.json (1MB) | < 2ms | ~200ms | **100x** |
| package-lock.json (100MB) | < 100ms | ~10s | **100x** |
| yarn.lock (1MB) | < 5ms | ~300ms | **60x** |
| pnpm-lock.yaml (1MB) | < 8ms | ~400ms | **50x** |
| Lookup by name | < 20ns | ~5µs | **250x** |

### How We Achieve 100x

1. **simdjson** - SIMD-accelerated JSON at 2.5GB/s (vs ~25MB/s for JSON.parse)
2. **Memory mapping** - Zero-copy file access, OS handles caching
3. **Lazy parsing** - Only materialize accessed fields
4. **String interning** - Package names stored once, referenced many times
5. **Robin Hood hashing** - Fast O(1) lookup with good cache behavior
6. **Arena allocator** - Single malloc for entire parse result
7. **SIMD newline scanning** - Find yarn.lock entries 16/32 bytes at a time

## Build Configuration

### `smol_manifest.gypi`

```python
{
  'targets': [
    {
      'target_name': 'smol_manifest',
      'type': 'static_library',
      'sources': [
        'smol_manifest_binding.cc',
        'smol_manifest_json.cc',
        'smol_manifest_yaml.cc',
        'smol_manifest_toml.cc',
        'smol_manifest_custom.cc',
        'smol_manifest_v8_binding.cc',
      ],
      'include_dirs': [
        '.',
        '<(node_root_dir)/src',
        '<(node_root_dir)/deps/v8/include',
        '<(node_root_dir)/deps/simdjson',
        '<(node_root_dir)/deps/rapidyaml/src',
        '<(node_root_dir)/deps/toml++/include',
      ],
      'dependencies': [
        '<(node_lib_target)',
        '<(node_root_dir)/deps/simdjson/simdjson.gyp:simdjson',
        '<(node_root_dir)/deps/rapidyaml/rapidyaml.gyp:rapidyaml',
      ],
      'defines': [
        'NODE_WANT_INTERNALS=1',
        'SIMDJSON_EXCEPTIONS=0',
      ],
      'conditions': [
        # Windows
        ['OS=="win"', {
          'msvs_settings': {
            'VCCLCompilerTool': {
              'AdditionalOptions': ['/std:c++17', '/Zc:__cplusplus'],
              'EnableEnhancedInstructionSet': '2',  # SSE2 baseline
            },
          },
          'defines': [
            'WIN32_LEAN_AND_MEAN',
            'NOMINMAX',
          ],
        }],
        # macOS
        ['OS=="mac"', {
          'xcode_settings': {
            'CLANG_CXX_LANGUAGE_STANDARD': 'c++17',
            'CLANG_CXX_LIBRARY': 'libc++',
            'MACOSX_DEPLOYMENT_TARGET': '10.15',
            'OTHER_CPLUSPLUSFLAGS': ['-fno-exceptions', '-fno-rtti'],
          },
          'conditions': [
            ['target_arch=="x64"', {
              'xcode_settings': {
                'OTHER_CPLUSPLUSFLAGS': ['-msse4.2', '-mavx2'],
              },
              'defines': ['SMOL_ARCH_X64=1'],
            }],
            ['target_arch=="arm64"', {
              'xcode_settings': {
                'OTHER_CPLUSPLUSFLAGS': ['-march=armv8-a+simd'],
              },
              'defines': ['SMOL_ARCH_ARM64=1'],
            }],
          ],
        }],
        # Linux
        ['OS=="linux"', {
          'cflags_cc': [
            '-std=c++17',
            '-fno-exceptions',
            '-fno-rtti',
            '-fvisibility=hidden',
          ],
          'conditions': [
            ['target_arch=="x64"', {
              'cflags_cc': ['-msse2', '-msse4.2'],
              'defines': ['SMOL_ARCH_X64=1'],
            }],
            ['target_arch=="arm64"', {
              'cflags_cc': ['-march=armv8-a+simd'],
              'defines': ['SMOL_ARCH_ARM64=1'],
            }],
            ['target_arch=="arm"', {
              'cflags_cc': ['-mfpu=neon', '-mfloat-abi=hard'],
              'defines': ['SMOL_ARCH_ARM32=1'],
            }],
          ],
        }],
        # FreeBSD/OpenBSD/NetBSD
        ['OS=="freebsd" or OS=="openbsd" or OS=="netbsd"', {
          'cflags_cc': ['-std=c++17', '-fno-exceptions', '-fno-rtti'],
        }],
      ],
    },
  ],
}
```

## Cross-Platform SIMD Architecture

### Memory-Mapped File Access

```cpp
#include "smol_simd.h"

#if defined(_WIN32)
  #include <windows.h>
#else
  #include <sys/mman.h>
  #include <sys/stat.h>
  #include <fcntl.h>
  #include <unistd.h>
#endif

namespace smol {
namespace manifest {

class MemoryMappedFile {
 public:
  MemoryMappedFile() = default;
  ~MemoryMappedFile() { Close(); }

  // Non-copyable
  MemoryMappedFile(const MemoryMappedFile&) = delete;
  MemoryMappedFile& operator=(const MemoryMappedFile&) = delete;

  bool Open(const char* path) {
#if defined(_WIN32)
    file_ = CreateFileA(path, GENERIC_READ, FILE_SHARE_READ,
                        nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (file_ == INVALID_HANDLE_VALUE) return false;

    LARGE_INTEGER file_size;
    if (!GetFileSizeEx(file_, &file_size)) {
      CloseHandle(file_);
      return false;
    }
    size_ = static_cast<size_t>(file_size.QuadPart);

    mapping_ = CreateFileMappingA(file_, nullptr, PAGE_READONLY, 0, 0, nullptr);
    if (!mapping_) {
      CloseHandle(file_);
      return false;
    }

    data_ = static_cast<const char*>(
        MapViewOfFile(mapping_, FILE_MAP_READ, 0, 0, 0));
    return data_ != nullptr;

#else  // POSIX (Linux, macOS)
    fd_ = open(path, O_RDONLY);
    if (fd_ < 0) return false;

    struct stat st;
    if (fstat(fd_, &st) < 0) {
      close(fd_);
      return false;
    }
    size_ = static_cast<size_t>(st.st_size);

    data_ = static_cast<const char*>(
        mmap(nullptr, size_, PROT_READ, MAP_PRIVATE, fd_, 0));
    if (data_ == MAP_FAILED) {
      close(fd_);
      data_ = nullptr;
      return false;
    }

    // Advise sequential access for better readahead
    madvise(const_cast<char*>(data_), size_, MADV_SEQUENTIAL);
    return true;
#endif
  }

  void Close() {
#if defined(_WIN32)
    if (data_) UnmapViewOfFile(data_);
    if (mapping_) CloseHandle(mapping_);
    if (file_ != INVALID_HANDLE_VALUE) CloseHandle(file_);
    file_ = INVALID_HANDLE_VALUE;
    mapping_ = nullptr;
#else
    if (data_) munmap(const_cast<char*>(data_), size_);
    if (fd_ >= 0) close(fd_);
    fd_ = -1;
#endif
    data_ = nullptr;
    size_ = 0;
  }

  const char* data() const { return data_; }
  size_t size() const { return size_; }
  std::string_view view() const { return {data_, size_}; }

 private:
  const char* data_ = nullptr;
  size_t size_ = 0;

#if defined(_WIN32)
  HANDLE file_ = INVALID_HANDLE_VALUE;
  HANDLE mapping_ = nullptr;
#else
  int fd_ = -1;
#endif
};

}  // namespace manifest
}  // namespace smol
```

### SIMD Line Scanner for yarn.lock

```cpp
#include "smol_simd.h"

namespace smol {
namespace manifest {

// Find next newline using SIMD (for yarn.lock parsing)
// Returns offset from start, or len if not found

#if SMOL_HAS_SSE2
SMOL_FORCE_INLINE size_t FindNewlineSSE2(const char* data, size_t len) {
  __m128i newline = _mm_set1_epi8('\n');
  size_t i = 0;

  for (; i + 16 <= len; i += 16) {
    __m128i chunk = _mm_loadu_si128(
        reinterpret_cast<const __m128i*>(data + i));
    __m128i cmp = _mm_cmpeq_epi8(chunk, newline);
    int mask = _mm_movemask_epi8(cmp);
    if (mask) {
#if defined(_MSC_VER)
      unsigned long idx;
      _BitScanForward(&idx, mask);
      return i + idx;
#else
      return i + __builtin_ctz(mask);
#endif
    }
  }

  // Scalar remainder
  for (; i < len; i++) {
    if (data[i] == '\n') return i;
  }
  return len;
}
#endif

#if SMOL_COMPILE_AVX2
SMOL_FORCE_INLINE size_t FindNewlineAVX2(const char* data, size_t len) {
  __m256i newline = _mm256_set1_epi8('\n');
  size_t i = 0;

  for (; i + 32 <= len; i += 32) {
    __m256i chunk = _mm256_loadu_si256(
        reinterpret_cast<const __m256i*>(data + i));
    __m256i cmp = _mm256_cmpeq_epi8(chunk, newline);
    int mask = _mm256_movemask_epi8(cmp);
    if (mask) {
#if defined(_MSC_VER)
      unsigned long idx;
      _BitScanForward(&idx, mask);
      return i + idx;
#else
      return i + __builtin_ctz(mask);
#endif
    }
  }

  return i + FindNewlineSSE2(data + i, len - i);
}
#endif

#if SMOL_HAS_NEON
SMOL_FORCE_INLINE size_t FindNewlineNEON(const char* data, size_t len) {
  uint8x16_t newline = vdupq_n_u8('\n');
  size_t i = 0;

  for (; i + 16 <= len; i += 16) {
    uint8x16_t chunk = vld1q_u8(
        reinterpret_cast<const uint8_t*>(data + i));
    uint8x16_t cmp = vceqq_u8(chunk, newline);

    uint64x2_t cmp64 = vreinterpretq_u64_u8(cmp);
    uint64_t combined = vgetq_lane_u64(cmp64, 0) | vgetq_lane_u64(cmp64, 1);
    if (combined) {
      // Find position
      for (size_t j = 0; j < 16 && i + j < len; j++) {
        if (data[i + j] == '\n') return i + j;
      }
    }
  }

  for (; i < len; i++) {
    if (data[i] == '\n') return i;
  }
  return len;
}
#endif

inline size_t FindNewline(const char* data, size_t len) {
#if SMOL_COMPILE_AVX2
  if (simd::g_has_avx2) {
    return FindNewlineAVX2(data, len);
  }
#endif
#if SMOL_HAS_SSE2
  return FindNewlineSSE2(data, len);
#elif SMOL_HAS_NEON
  return FindNewlineNEON(data, len);
#else
  for (size_t i = 0; i < len; i++) {
    if (data[i] == '\n') return i;
  }
  return len;
#endif
}

// Skip whitespace at start of line (for indentation detection)
SMOL_FORCE_INLINE size_t SkipWhitespace(const char* data, size_t len) {
  size_t i = 0;
  // Most lines have 0-4 spaces, unroll for common case
  while (i < len && i < 8 && (data[i] == ' ' || data[i] == '\t')) {
    i++;
  }
  if (i >= 8) {
    while (i < len && (data[i] == ' ' || data[i] == '\t')) {
      i++;
    }
  }
  return i;
}

}  // namespace manifest
}  // namespace smol
```

### String Interning for Package Names

```cpp
#include <atomic>
#include <string_view>

namespace smol {
namespace manifest {

// Lock-free string interner for package names
// Dramatically reduces memory for lockfiles with many deps
class StringInterner {
 public:
  static constexpr size_t kPoolSize = 1 << 20;  // 1MB pool
  static constexpr size_t kMaxStrings = 65536;

  std::string_view Intern(std::string_view s) {
    // Check if already interned (fast path)
    uint64_t hash = Hash(s);
    size_t idx = hash & (kMaxStrings - 1);

    for (size_t i = 0; i < 8; i++) {
      Entry& e = entries_[(idx + i) & (kMaxStrings - 1)];
      uint64_t stored = e.hash.load(std::memory_order_acquire);
      if (stored == hash) {
        std::string_view interned(pool_ + e.offset, e.length);
        if (interned == s) return interned;
      }
      if (stored == 0) break;  // Empty slot - not found
    }

    // Intern new string
    size_t offset = pool_pos_.fetch_add(s.size() + 1, std::memory_order_relaxed);
    if (offset + s.size() >= kPoolSize) {
      // Pool exhausted - return copy (slow path)
      return s;
    }

    memcpy(pool_ + offset, s.data(), s.size());
    pool_[offset + s.size()] = '\0';

    // Store in hash table
    for (size_t i = 0; i < 8; i++) {
      Entry& e = entries_[(idx + i) & (kMaxStrings - 1)];
      uint64_t expected = 0;
      if (e.hash.compare_exchange_strong(expected, hash,
              std::memory_order_release, std::memory_order_relaxed)) {
        e.offset = static_cast<uint32_t>(offset);
        e.length = static_cast<uint32_t>(s.size());
        break;
      }
    }

    return std::string_view(pool_ + offset, s.size());
  }

 private:
  static uint64_t Hash(std::string_view s) {
    uint64_t h = 14695981039346656037ull;
    for (char c : s) {
      h ^= static_cast<uint8_t>(c);
      h *= 1099511628211ull;
    }
    return h | 1;  // Ensure non-zero
  }

  struct Entry {
    std::atomic<uint64_t> hash{0};
    uint32_t offset;
    uint32_t length;
  };

  alignas(64) char pool_[kPoolSize];
  std::atomic<size_t> pool_pos_{0};
  alignas(64) Entry entries_[kMaxStrings];
};

// Thread-local interner
thread_local StringInterner g_interner;

}  // namespace manifest
}  // namespace smol
```

### Robin Hood Hash Map for Package Lookup

```cpp
// Fast O(1) package lookup with excellent cache behavior
template<typename V>
class RobinHoodMap {
 public:
  static constexpr size_t kLoadFactor = 90;  // 90% load factor

  explicit RobinHoodMap(size_t expected_size) {
    // Round up to power of 2
    size_t capacity = 16;
    while (capacity * kLoadFactor / 100 < expected_size) {
      capacity *= 2;
    }
    entries_.resize(capacity);
    mask_ = capacity - 1;
  }

  void Insert(std::string_view key, V value) {
    uint64_t hash = Hash(key);
    size_t idx = hash & mask_;
    size_t dist = 0;

    Entry entry{hash, key, std::move(value)};

    while (true) {
      Entry& slot = entries_[idx];

      if (slot.hash == 0) {
        // Empty slot
        slot = std::move(entry);
        size_++;
        return;
      }

      size_t slot_dist = (idx - (slot.hash & mask_)) & mask_;
      if (dist > slot_dist) {
        // Robin Hood: steal from rich, give to poor
        std::swap(entry, slot);
        dist = slot_dist;
      }

      idx = (idx + 1) & mask_;
      dist++;
    }
  }

  const V* Find(std::string_view key) const {
    uint64_t hash = Hash(key);
    size_t idx = hash & mask_;
    size_t dist = 0;

    while (true) {
      const Entry& slot = entries_[idx];

      if (slot.hash == 0) return nullptr;

      size_t slot_dist = (idx - (slot.hash & mask_)) & mask_;
      if (dist > slot_dist) return nullptr;

      if (slot.hash == hash && slot.key == key) {
        return &slot.value;
      }

      idx = (idx + 1) & mask_;
      dist++;
    }
  }

 private:
  static uint64_t Hash(std::string_view s) {
    uint64_t h = 14695981039346656037ull;
    for (char c : s) {
      h ^= static_cast<uint8_t>(c);
      h *= 1099511628211ull;
    }
    return h | 1;
  }

  struct Entry {
    uint64_t hash = 0;
    std::string_view key;
    V value;
  };

  std::vector<Entry> entries_;
  size_t mask_;
  size_t size_ = 0;
};
```

## Dependencies

### simdjson
- Already used in Node.js for JSON.parse optimization
- ~2.5GB/s parsing speed
- SIMD-accelerated (AVX2, NEON)

### rapidyaml
- Header-only YAML parser
- ~40x faster than libyaml
- ~100x faster than yaml-cpp
- Supports YAML 1.1

### toml++ (optional)
- Header-only TOML parser
- Modern C++17
- Fast and standards-compliant

## Implementation Phases

### Phase 1: JSON Formats
- package.json parsing
- package-lock.json (v2/v3)
- composer.json/lock
- V8 bindings

### Phase 2: YAML Formats
- rapidyaml integration
- pnpm-lock.yaml
- pubspec.yaml

### Phase 3: Custom Formats
- yarn.lock parser
- Gemfile.lock parser
- go.sum/go.mod parser

### Phase 4: TOML & XML
- Cargo.toml/lock
- pyproject.toml
- pom.xml

### Phase 5: Optimization
- Streaming parser for large files
- Memory pooling
- Parallel parsing

## Migration Path

### From socket-sbom-generator

```javascript
// Before
const { parseLockfile } = require('./parsers/npm');
const lock = parseLockfile(content);

// After
const manifest = require('node:smol-manifest');
const lock = manifest.parseLockfile(content, 'npm');
```

### From lockfile-parser

```javascript
// Before
const { parseYarnLock } = require('@yarnpkg/lockfile');
const result = parseYarnLock(content);

// After
const manifest = require('node:smol-manifest');
const result = manifest.parse('yarn.lock', content);
```
