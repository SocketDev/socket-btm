# smol-manifest Full-Native Plan

> **Status: Selected direction.** This plan moves the entire lockfile parser to C++ — tokenization _and_ structural assembly — and returns a fully-built `ParsedLockfile` object across the binding. The goal is raw performance: no JS frames in the parser hot path at all.
>
> **Reference flow:** `socket-sdxgen/src/parsers/<eco>/*.mts` is the canonical algorithm. We port it to C++ (with the 4 already-shipped bug fixes folded in), then socket-lib v6.0.0 exports TS-equivalent parsers that route to the native binding when the smol Node binary is present, and to a pure-JS port of the same sdxgen logic otherwise. At v6.0.0 release, sdxgen migrates from its own in-repo parsers to socket-lib's exports.
>
> **The flow:**
>
> ```
>   socket-sdxgen/src/parsers/<eco>/*.mts   ← canonical reference
>           ↓
>   node-smol-builder/src/socketsecurity/manifest/*.cc   ← native impl
>           ↓
>   node-smol-builder/lib/smol-manifest.js   ← V8 binding facade
>           ↓
>   socket-lib/src/eco/<eco>/*.ts   ← public API + JS fallback (port of sdxgen)
>           ↓
>   socket-lib v6.0.0   ← consumers (sdxgen migrates here at v6.0.0 cut)
> ```

## TL;DR — head-to-head with the tokenizer-only alternative

| Axis                       | Tokenizer-only (B2)                | Full-native (this doc)                                |
| -------------------------- | ---------------------------------- | ----------------------------------------------------- |
| Tokenizer perf             | ~5–10x JS                          | ~5–10x JS (same code)                                 |
| Total parse perf           | ~2–4x JS (JS assembly bottleneck)  | **~15–40x JS** on large lockfiles                     |
| Object creation cost       | Per-PackageRef JS frame            | Single bulk V8 transfer (interned strings + frozen)   |
| String allocs (large file) | O(packages × fields)               | **O(1) bulk transfer** via SerializeAsHostObject path |
| Memory peak                | content buf + JS objects           | content buf + arena, then released                    |
| C++ LOC                    | ~600                               | ~3000–4000                                            |
| Bug-fix churn surface      | JS (cheap edits, ship daily)       | **C++ (rebuild + ship smol binary)**                  |
| Fallback when smol absent  | JS path identical                  | JS path identical (must maintain in parallel)         |
| Divergence risk            | Low — one tokenizer, two consumers | **High — two full parsers must agree**                |
| Cross-format reuse         | Tokenizer shared yarn+pnpm         | Each format = full impl                               |
| Time to ship               | ~3–5 days                          | ~3–4 weeks                                            |

**Honest verdict for the impatient reader:** the tokenizer plan recovers ~70% of the win for ~15% of the code. The full-native plan is only the right answer if (a) parsers run inside a tight loop where call overhead dominates (e.g., scanning thousands of small lockfiles), or (b) we're willing to pay the maintenance tax forever to extract the last 2-3x.

The rest of this doc assumes you've accepted that tax and want the perf ceiling.

## Reference implementations (read these first)

**Canonical: socket-sdxgen.** Every parser in this plan is a port of the corresponding sdxgen file. sdxgen has the most production exposure (Socket's batch-ingestion pipeline scans millions of repos through it) and the bug fixes that landed in socket-btm + socket-lib during the QA pass originated from sdxgen. When the C++ impl and sdxgen disagree, sdxgen wins; when sdxgen and the existing JS port disagree, sdxgen wins; when sdxgen disagrees with itself across versions, the newer file wins. **sdxgen is the oracle.**

| Ecosystem      | sdxgen source (canonical reference)                       |
| -------------- | --------------------------------------------------------- |
| npm v1         | `socket-sdxgen/src/parsers/npm/package-lock-v1.mts`       |
| npm v2/v3      | `socket-sdxgen/src/parsers/npm/package-lock-v2.mts`       |
| npm shrinkwrap | `socket-sdxgen/src/parsers/npm/npm-shrinkwrap.mts`        |
| pnpm v5        | `socket-sdxgen/src/parsers/pnpm/pnpm-lock-v5.mts`         |
| pnpm v6        | `socket-sdxgen/src/parsers/pnpm/pnpm-lock-v6.mts`         |
| pnpm v9        | `socket-sdxgen/src/parsers/pnpm/pnpm-lock-v9.mts`         |
| yarn v1        | `socket-sdxgen/src/parsers/yarn-classic/yarn-lock-v1.mts` |
| yarn v2+       | `socket-sdxgen/src/parsers/yarn-berry/yarn-lock-v2.mts`   |
| yarn v6 (zpm)  | `socket-sdxgen/src/parsers/zpm/yarn-lock-v6.mts`          |
| cargo          | `socket-sdxgen/src/parsers/cargo/index.mts`               |

**Out of scope for the v6.0.0 native cut** (sdxgen owns these until a later phase): maven, gradle, nuget, pypi, go, rubygems, packagist, swift, sbt, hex, conan, cocoapods, bun, vlt. These continue to live in sdxgen's TS parsers; socket-lib v6.0.0 will re-export thin wrappers around them so the consumer-facing API is uniform across all ecosystems, but only the table above gets the C++ acceleration in this phase.

**Existing port targets the C++ impl must match byte-for-byte.** These are the JS reference for "what shape the binding returns":

- `packages/node-smol-builder/additions/source-patched/lib/internal/socketsecurity/manifest.js` — current pure-JS impl inside the smol Node binary. Stays in-tree as the equivalence-suite oracle (see _Risk_ below).
- `socket-lib/src/eco/npm/{pnpm,yarnpkg/yarn,npm}/parse-lockfile.ts` + `socket-lib/src/eco/cargo/parse-lockfile.ts` — TS port that already routes to the smol binding when present. The native impl must return the same `ParsedLockfile` shape (same field order, same frozen-ness, same `_index` representation).

**C++ binding layout to mirror.** We already have proven N-API bindings inside smol:

- `packages/node-smol-builder/additions/source-patched/src/socketsecurity/versions/{versions.h,versions.cc,versions_binding.cc}` — semver. Pattern: header + impl + `*_binding.cc` for the V8 surface, all three under `src/socketsecurity/<feature>/`. The manifest binding follows the same shape.

## Bug fix register (the 4 fixes the C++ port must preserve)

These bugs were originally caught in sdxgen, then ported to socket-btm's JS impl + socket-lib's TS port during the QA pass. The C++ port lands them at the source — every implementation in the reference flow must encode these. **Each one needs a regression test in the equivalence suite naming the originating incident.**

### Fix 1 — npm v1 alias extraction

**Bug:** v1 lockfiles encode aliased installs as `version: "npm:<real-name>@<real-version>"`. Previous impls emitted the alias key directly, producing a malformed purl (`pkg:npm/alias@npm%3Areal%401.0`) pointing at a non-existent registry package.

**Fix shape (C++):**

```cpp
// In parser_npm.cc when building PackageRef from v1 entry:
std::string_view effective_name = entry_key;
std::string_view version = entry.version;
if (StartsWith(version, "npm:")) {
  std::string_view rest = version.substr(4);
  size_t at = rest.rfind('@');
  if (at > 0 && at != std::string_view::npos) {
    effective_name = rest.substr(0, at);
    version = rest.substr(at + 1);
  }
}
```

**Test:** `parsePackageLock` of `{ lockfileVersion: 1, dependencies: { 'string-width-cjs': { version: 'npm:string-width@4.2.3', ... } } }` produces a single PackageRef named `string-width` at version `4.2.3`. See sdxgen test fixtures for canonical cases.

### Fix 2 — npm v2/v3 workspace + alias name preference

**Bug:** v2/v3 lockfiles key workspace entries by relative path (e.g. `packages/ui`) without the `node_modules/` prefix. Path-derived name extraction returned `ui` instead of `@my-org/ui`. Same root cause for alias entries: `"node_modules/sw-cjs": { name: "string-width", version: "4.2.3" }` was extracting `sw-cjs` from the path instead of using `pkg.name`.

**Fix shape (C++):** prefer `pkg.name` when present and non-empty; fall back to path-derived extraction.

```cpp
// In parser_npm.cc parseV2V3:
std::string_view name;
if (!entry.name.empty()) {
  name = entry.name;
} else {
  name = ExtractPackageNameFromPath(pkg_path);
}
```

**Test:** both workspace-path entries with `name: "@my-org/ui"` AND aliased `node_modules/<alias>` entries with `name: "<real>"` resolve to the real name.

### Fix 3 — pnpm v9 empty-version + workspace/file filter

**Two bugs in one section:**

**3a. Empty-version guard:** pnpm v9 importer entries can use the block shape:

```yaml
pkg:
  specifier: ^1
  version: 1.0.0
```

The previous impl emitted a PackageRef with empty `version: ""` for the parent line before the indented version: line was consumed.

**Fix shape (C++):** in the importer-walk, skip entries whose extracted version string is empty:

```cpp
if (dep_version.empty()) continue;
```

**3b. Workspace/file/link protocol filter:** importer dep values like `workspace:^1.0.0`, `file:./local.tgz`, `link:packages/my-workspace` are not real registry packages — they reference local workspaces / tarballs / symlinks. Previous impls emitted them as if they were real deps with non-semver versions.

**Fix shape (C++):**

```cpp
if (StartsWith(dep_version, "link:") ||
    StartsWith(dep_version, "workspace:") ||
    StartsWith(dep_version, "file:")) {
  continue;
}
```

Both filters must combine. Test fixture: a lockfile with one of each (ws-dep, file-dep, link-dep, real-dep) — only `real-dep` survives.

### Fix 4 — yarn `dependenciesMeta` inversion

**Bug:** yarn's `dependenciesMeta` section is positional metadata about the dep just declared. The previous impl was treating the metadata as if it _was_ a dep declaration, so `optional: true` flagged the wrong package as optional and synthesized phantom entries.

**Fix shape (C++):** when walking yarn's nested-block lines, consume `dependenciesMeta` lines for position-tracking only — never synthesize a PackageRef from them:

```cpp
// In parser_yarn.cc:
if (current_section == "dependenciesMeta") {
  // Consume the indented block but do NOT emit packages.
  ConsumeIndentedBlock(scanner);
  continue;
}
```

**Test:** the existing yarn fixture that previously asserted `isOptional: true` on a real dep (which was the buggy behavior) now asserts `isOptional: false`. Test description should note: "previously asserted buggy behavior; flipped to correct semantics."

### Fix 5 (pending) — pnpm v9 isDev derivation

**Status: deferred.** This is a structural change requiring prod-set / dev-only-set classification from importer entries + a second pass over snapshots. **Native port must NOT inherit the buggy partial implementation.** When the C++ port reaches the pnpm v9 isDev classification, do it correctly from the start — derive `isDev` from the importers' `devDependencies` block, post-pass classify each snapshot entry against the prod/dev sets, and break ties toward `isDev: false` (matches npm semantics: any package reachable from a prod dep is prod).

Concretely: build two `std::unordered_set<std::string_view>` (prod, devOnly) from the importer pass, then after the snapshot pass walk each PackageRef and set `isDev = !prod.contains(ref.name) && devOnly.contains(ref.name)`. Document the rule in a comment.

### Cargo `[[patch.unused]]` (false positive — no fix needed)

**Status: no fix.** During the QA pass we suspected `[[patch.unused]]` entries were leaking as real deps; testing showed the existing `trimmed == "[[package]]"` else `currentEntry = undefined` logic already filters them. **Native port must keep this filter explicit** — a test in the equivalence suite asserts patch-unused entries don't materialize.

## v6.0.0 release flow

**Current state (pre-v6.0.0):**

- sdxgen ships its own parsers at `src/parsers/<eco>/*.mts`.
- socket-btm's smol binary ships pure-JS parsers (mirror of sdxgen) at `lib/internal/socketsecurity/manifest.js`.
- socket-lib v5.x ships TS ports of the same parsers at `src/eco/<eco>/parse-lockfile.ts`, dispatching to smol when present.

**v6.0.0 cut sequence:**

1. **socket-btm lands C++ port** (this plan). The smol binary now serves native parsers via `internalBinding('smol_manifest_native')`. The JS-mirror file (`manifest.js`) stays in-tree as the equivalence oracle but is no longer the public-surface impl.
2. **socket-btm publishes** a tagged smol binary with the native parsers in `external-tools.json`.
3. **socket-lib v6.0.0 lands**. The `src/eco/<eco>/parse-lockfile.ts` files unchanged in structure — they already route to `getSmolManifest()` when present. With the new smol binary in `external-tools.json`, every socket-lib consumer transparently picks up the native perf.
4. **socket-lib v6.0.0 publishes** to npm with the bumped smol pin.
5. **socket-sdxgen v<next> migrates.** Replace `src/parsers/<eco>/*.mts` with re-exports from `@socketsecurity/lib-stable/eco/<eco>`. sdxgen's parsers directory shrinks from ~25 files to ~10 (only the ecosystems not covered by socket-lib v6.0.0's native cut — maven, gradle, nuget, etc. — keep their original sdxgen impls). All native-cut ecosystems route to socket-lib, which routes to the smol binary.

After v6.0.0 ships, **sdxgen owns the not-yet-native ecosystems and socket-lib owns the native ones**. Both consume the same smol binary. Bug fixes for native-cut ecosystems land in sdxgen (the source of truth for the algorithm) → C++ in socket-btm → socket-lib pins the new smol → sdxgen pulls socket-lib. Bug fixes for not-yet-native ecosystems land in sdxgen and stay there until that ecosystem joins the native cut in a later phase.

**Drift control:** the equivalence suite (see _Testing_) runs sdxgen's parser output against the C++ binding's output for every fixture. Any divergence fails CI — neither side can drift silently. Once sdxgen migrates to socket-lib's re-exports for native-cut ecosystems, this becomes self-policing: sdxgen literally cannot call a different impl.

## Why this can win bigger than the tokenizer plan

The tokenizer plan ships ~5x on the tokenizer step, but Amdahl's-law caps total speedup. Profile of `parsePnpmLock` on a 200-pkg monorepo (~80k lines):

```
51%   line tokenization (indentOf, indexOf, slice, startsWith)
28%   PackageRef construction (ObjectFreeze + 14 property writes × N pkgs)
14%   peer-suffix stripping + dep-classification (StringPrototypeSlice loops)
 5%   JSON/YAML byproducts (small)
 2%   index assembly
```

Move the 51% to C++ and the rest still pins us to ~2x total. Move **all 100%** to C++ and the floor becomes V8↔C++ marshalling overhead, which we can amortize by returning a single pre-built object graph.

The leverage points the tokenizer plan can't touch:

1. **String interning** — package names + version strings repeat heavily inside a single lockfile. A C++ side `std::unordered_map<std::string_view, Local<String>>` interns each unique string once per parse, instead of N times via JS-side substring extraction. Drops string allocation by 60–80% on real fixtures.
2. **Bulk object construction** — use `v8::Object::SetInternalField` + a struct-of-arrays layout in C++, then transfer in one go. Skips N × 14 property writes.
3. **No JS frames in the hot loop** — the tokenizer plan still has a JS for-loop iterating the token array, calling JS helpers, building JS objects. Removing it removes a huge chunk of interpreter/JIT-warmup cost on first-call.
4. **SIMD on key matching** — `packages:`, `dependencies:`, `devDependencies:`, `peerDependencies:`, `resolution:`, `integrity:` are the 6 hottest keys. AVX2 / NEON 16-byte-at-a-time `memcmp` on the indented line head dispatches in 1 cycle instead of 6–12 JS instructions.
5. **Arena allocation** — all intermediate parse state (raw entries, dep lists, suffix-stripped versions) lives in a single bump allocator that we free at end of parse. Zero `free()` calls during parse.

## Performance budget

Target: **20x** on the end-to-end `parsePnpmLock` / `parseYarnLock` for large monorepo lockfiles. **5x** on small lockfiles (overhead-dominated regime).

Three benchmarks gate the merge:

1. **Large pnpm** — 200-pkg monorepo, ~80k lines, expect ≥ 20x.
2. **Large yarn** — 600-pkg monorepo, ~120k lines, expect ≥ 20x.
3. **Small lockfile** — 30-pkg single-package, ~600 lines, expect ≥ 5x (and no regression vs. JS — the bar at small sizes is "don't lose ground").

If we miss (1) or (2), revert to the tokenizer plan — it's the strictly cheaper win.

If we miss (3), keep a JS path for `content.length < 16KB` and dispatch on size. Acceptable hybrid.

## C++ Architecture

### Module layout

```
src/socketsecurity/manifest/
  manifest.h               # Public types: PackageRef, ParsedLockfile, ParseError
  manifest_binding.cc      # V8 surface
  parser_pnpm.{h,cc}       # pnpm v5/v6/v9
  parser_yarn.{h,cc}       # yarn classic v1
  parser_yarn_berry.{h,cc} # yarn Berry (YAML) — optional, see _What stays JS_
  parser_npm.{h,cc}        # npm v1/v2/v3 (uses simdjson, see below)
  parser_cargo.{h,cc}      # cargo TOML
  intern.{h,cc}            # string interning arena
  arena.h                  # bump allocator
  keys.{h,cc}              # SIMD-accelerated keyword matcher
```

Total estimated C++ LOC: 3000–4000 across these.

### Public C++ types (`manifest.h`)

```cpp
namespace node::socketsecurity::manifest {

// PackageRef — a single dependency entry in the parsed result.
// Layout pinned for cache locality; fields ordered hot → cold.
struct PackageRef {
  std::string_view name;       // arena-owned
  std::string_view version;
  std::string_view resolved;
  std::string_view integrity;
  std::string_view license;
  std::string_view vcsUrl;
  std::string_view vcsCommit;
  std::vector<std::string_view> dependencies;  // arena-owned
  uint8_t depType;             // enum DepType
  bool isDev;
  bool isOptional;
  bool isPeer;
  bool isBundled;
};

enum class DepType : uint8_t { kProd = 0, kDev = 1, kOptional = 2, kPeer = 3 };

enum class Ecosystem : uint8_t { kNpm = 0, kCargo = 1, kPypi = 2, /* … */ };

enum class LockFormat : uint8_t {
  kNpmV1, kNpmV2V3,
  kYarnClassic, kYarnBerry,
  kPnpmV5, kPnpmV9,
  kCargo,
};

struct ParsedLockfile {
  LockFormat format;
  Ecosystem ecosystem;
  std::string_view lockVersion;
  std::vector<PackageRef> packages;
  // packageIndex: name → idx or [idx,idx,...]
  std::unordered_map<std::string_view, std::variant<uint32_t, std::vector<uint32_t>>> index;
};

struct ParseError {
  std::string message;
  std::string code;  // 'ERR_INVALID_JSON' | 'ERR_INVALID_LOCKFILE' | …
};

// Single entry point. Routes on format. Returns a ParsedLockfile or
// fills ParseError. Never throws C++ exceptions.
bool ParseLockfile(const uint8_t* data, size_t size,
                   Ecosystem eco, LockFormat hint,
                   ParsedLockfile* out, ParseError* err);

}  // namespace
```

### Parser implementations

- **`parser_pnpm.cc`** — direct port of `additions/.../manifest.js`'s pnpm logic. The state machine collapses to one switch + tight loop; the v9 importer/snapshot split is two passes over the same buffer.
- **`parser_yarn.cc`** — port of yarn classic logic. Uses `keys.cc`'s SIMD-matcher for the 8 common section keys.
- **`parser_npm.cc`** — uses **simdjson** (vendored, already used in the wider Node ecosystem; ~1GB/s parse). Builds PackageRef directly from simdjson's iterator without intermediate `v8::Object`.
- **`parser_cargo.cc`** — uses a minimal hand-rolled TOML scanner (Cargo lockfiles are a strict TOML subset; full toml++ is overkill).
- **`parser_yarn_berry.cc`** — optional. Yarn Berry is YAML — we'd need to vendor `yaml-cpp` or a smaller lib. Recommendation: keep JS for now and route only on detected v6+ format.

### Arena + intern

```cpp
// arena.h
class Arena {
  // 64KB chunks, bump-allocate. No free() until destructor.
  std::vector<std::unique_ptr<char[]>> chunks_;
  char* head_;
  size_t remaining_;
 public:
  char* Allocate(size_t bytes);
  std::string_view Copy(std::string_view s);  // memcpy into arena, return view
};

// intern.h
class StringInterner {
  Arena* arena_;
  std::unordered_map<std::string_view, std::string_view> map_;
 public:
  std::string_view Intern(std::string_view s);  // returns canonical view
};
```

Real lockfiles repeat names heavily — a 80k-line pnpm lockfile contains ~500 unique package names referenced ~5000 times. Interning collapses 5000 string copies into 500.

### SIMD keyword matcher (`keys.cc`)

```cpp
// Match a line's first ~24 bytes against a static set of section keys.
// Returns an enum kKnownKey or kUnknown. Uses AVX2 on x86-64, NEON on
// ARM64, scalar fallback elsewhere.
enum class KeyId : uint8_t {
  kUnknown = 0,
  kPackages, kImporters, kSnapshots,
  kDependencies, kDevDependencies, kOptionalDependencies, kPeerDependencies,
  kResolution, kResolved, kIntegrity, kVersion, kSpecifier,
  kOptional, kDev, kPeer, kBundled,
  // …
};
KeyId MatchKey(const uint8_t* line, size_t len);
```

The 95th-percentile line is ≤ 32 bytes, so a single 32-byte SIMD compare against each candidate is the right shape. On x86-64 this is `_mm256_cmpeq_epi8` + `_mm256_movemask_epi8`; on ARM64 it's `vceqq_u8` + bitmask. Returns in one cycle on the hot path.

### V8 binding surface (`manifest_binding.cc`)

One method:

```cpp
// parseLockfile(content: Buffer | string, ecosystem: number, format: number)
//   -> ParsedLockfileJsObject
//
// Returns a frozen JS object matching the existing ParsedLockfile type:
//   { type: 'lockfile', lockVersion, ecosystem, packages: PackageRef[],
//     _index: Record<string, number | number[]> }
//
// Throws ManifestError-shaped objects (Error subclass with `.code`) on
// failure, matching the JS path's error contract exactly.
```

**Bulk transfer trick**: build all `PackageRef` JS objects in a single `v8::Local<v8::Array>` with templated property creation. Use `v8::ObjectTemplate` with pre-declared `accessor`/`value` slots so V8 can fast-path the construction. Each PackageRef becomes ~1µs to materialize instead of ~20µs going through JS literal construction.

Frozen-object semantics match the JS path — call `o->SetIntegrityLevel(context, IntegrityLevel::kFrozen)` once per object before adding to the array.

## JS integration

### Refactor: socket-lib's dispatcher

Today, `src/eco/npm/pnpm/parse-lockfile.ts` does:

```ts
const _smol = getSmolManifest()
export const parsePnpmLock = _smol
  ? (content: string) =>
      _smol.parseLockfile(content, 'npm', 'pnpm') as ParsedLockfile
  : jsParsePnpmLock
```

That already routes to native when `process.smol` is present. **No code change in socket-lib.** This plan ships entirely inside `node-smol-builder`.

### Refactor: `manifest.js`

`additions/source-patched/lib/smol-manifest.js` exposes the C++ binding:

```js
const binding = internalBinding('smol_manifest_native')

function parseLockfile(content, ecosystem, format) {
  return binding.parseLockfile(
    content,
    ecoToInt(ecosystem),
    formatToInt(format),
  )
}

module.exports = { parseLockfile }
```

The existing JS-implementation file (`manifest.js`, 1375 lines) becomes the **reference / fallback / smoke-test oracle** — kept verbatim, but no longer wired into the smol public surface. Removing it entirely is tempting but risky: it's the divergence-detection lever (see _Risk_ below).

## Patches to edit

Same three patches as the tokenizer plan, but with more source files:

### `004-node-gyp-smol-sources.patch`

```diff
+            'src/socketsecurity/manifest/manifest_binding.cc',
+            'src/socketsecurity/manifest/parser_pnpm.cc',
+            'src/socketsecurity/manifest/parser_yarn.cc',
+            'src/socketsecurity/manifest/parser_npm.cc',
+            'src/socketsecurity/manifest/parser_cargo.cc',
+            'src/socketsecurity/manifest/intern.cc',
+            'src/socketsecurity/manifest/keys.cc',
+            # third_party/simdjson — vendored, single-header build
+            'src/socketsecurity/manifest/third_party/simdjson.cpp',
```

Vendoring simdjson adds ~3MB to the source tree but it's already MIT-licensed and a single `.cpp` + `.h` drop-in.

### `017-smol-builtin-bindings.patch`

```diff
+  V(smol_manifest_native)                                                      \
```

### `019-smol-external-refs.patch`

Same one-line addition.

## Testing

The native path must pass the existing `test/smol-manifest.test.mts` byte-for-byte. That's the correctness oracle.

Additional native-only suites:

1. **Cross-implementation equivalence** — for every fixture, run JS impl + native impl, deep-equal the results. The JS impl stays in-tree as the reference. CI fails if they diverge.
2. **Fuzz** — `cargo-fuzz`-style harness in C++ around `ParseLockfile()`, 1M random inputs, no crashes / no leaks.
3. **Memory** — `valgrind`/`asan` over a 200-fixture batch. Zero leaks. Arena peak < 4x input size.
4. **Perf gate** — the 3 benchmarks listed in _Performance budget_. CI runs them and fails the build if any regression > 10% lands.

## Risk + mitigations

- **Risk: divergence between C++ and JS impls.** This is the killer risk. Mitigation: ship them both, dual-run on every CI build via the equivalence suite. The day the C++ impl diverges silently is the day this strategy fails — we need the JS impl alive as the oracle. Cost: 1375 lines of JS we now maintain for testing, not production.
- **Risk: bug-fix latency.** A correctness bug in the C++ impl can't ship until we rebuild + republish the smol Node binary, which is a heavyweight release. Mitigation: the JS fallback still exists; when a critical C++ bug ships, we can dispatch on `process.env.SOCKET_DISABLE_NATIVE_MANIFEST` to force-route to JS until the next smol release. (This env var is a security trade-off — see token-hygiene rules — but a build-time-flippable feature flag in `process.smol` is fine.)
- **Risk: yarn Berry / cargo edge cases.** YAML and TOML have surprising corners. Mitigation: scope cuts. Ship pnpm + yarn classic + npm in the first cut. Cargo + yarn Berry stay JS until we have fuzz coverage.
- **Risk: build complexity.** simdjson + SIMD intrinsics means CI build matrices grow. Mitigation: gate SIMD behind `__AVX2__` / `__ARM_NEON` macros; scalar fallback always compiles. simdjson handles its own runtime SIMD dispatch.
- **Risk: not actually faster on small lockfiles.** Benchmark before committing to the full rewrite. The tokenizer plan is the cheaper backstop if small-lockfile perf is what matters.
- **Risk: V8 ABI changes.** Internal V8 APIs (templates, integrity-level fast paths) shift between Node majors. Mitigation: the smol binary already pins V8 per release; this isn't worse than the existing `smol_versions` exposure.

## Sequencing

Phase ordering follows the reference flow — start where sdxgen lives, end at v6.0.0.

1. **Bug-fix register translation** (0.5 day). Read each entry in the _Bug fix register_ section above against the sdxgen source it cites. Write one regression-test fixture per bug (4 fixtures + 1 deferred + 1 false-positive) into `node-smol-builder/test/fixtures/sdxgen-bug-regressions/`. These gate every step that follows.
2. **Arena + interner** (2 days). Pure C++, unit tests via smol's existing test harness.
3. **Equivalence harness** (1 day). Test runner that ingests a fixture, parses with sdxgen's TS impl + the C++ binding, deep-equals the `ParsedLockfile` shape. Empty C++ impl is fine at this stage — just the plumbing.
4. **`parser_pnpm.cc`** (5 days). Port sdxgen's `pnpm-lock-v{5,6,9}.mts` 1:1. Fix-3 (empty-version + workspace/file/link filter) lands the moment the v9 importer-walk lands. Run the equivalence suite from commit 1.
5. **`parser_yarn.cc`** (3 days). Port sdxgen's `yarn-lock-v1.mts`. Fix-4 (dependenciesMeta inversion) lands when the section walker lands.
6. **`parser_npm.cc`** with simdjson (2 days). Fix-1 (v1 alias extraction) lands in the v1 deps walker; Fix-2 (workspace+alias name preference) lands in the v2/v3 packages walker.
7. **`parser_cargo.cc`** (2 days). Cargo `[[patch.unused]]` filter test lands here.
8. **`manifest_binding.cc`** (3 days). V8 object construction + frozen-result transfer. Fix-5 (pnpm v9 isDev derivation, deferred in earlier impls) lands here in the post-pass classification — do it correctly from the start, do not inherit the partial-impl shape.
9. **SIMD `keys.cc`** (2 days). Skip in first cut if (4)–(7) already hit the perf bar.
10. **Benchmarks + fuzz** (3 days). The 3 perf benchmarks + asan + cargo-fuzz-style harness.
11. **socket-btm release** (0.5 day). Bump smol binary, publish to `external-tools.json`, tag.
12. **socket-lib v6.0.0** (1 day). Bump smol pin in `external-tools.json`. **No source changes** — the existing dispatcher in `src/eco/<eco>/parse-lockfile.ts` picks up the native binding automatically. CHANGELOG names the perf win and the migration story for sdxgen consumers.
13. **socket-sdxgen migration** (1–2 days, separate PR). Replace `src/parsers/{npm,pnpm,yarn-classic,yarn-berry,zpm,cargo}/*.mts` bodies with re-exports from `@socketsecurity/lib-stable/eco/*`. Other ecosystem dirs stay sdxgen-owned.

Total: ~4 weeks for steps 1–11, ~2 days each for steps 12 + 13, sequenced behind step 11's release.

## Migration playbook (for the sdxgen step)

When step 13 (sdxgen migration) lands, each native-cut parser file becomes a re-export. Sketch for `socket-sdxgen/src/parsers/pnpm/index.mts`:

```ts
// Before v6.0.0: 200+ lines of parser logic.
// After v6.0.0:
export { parsePnpmLock as parsePnpmLockV5 } from '@socketsecurity/lib-stable/eco/npm/pnpm/parse-lockfile'
export { parsePnpmLock as parsePnpmLockV6 } from '@socketsecurity/lib-stable/eco/npm/pnpm/parse-lockfile'
export { parsePnpmLock as parsePnpmLockV9 } from '@socketsecurity/lib-stable/eco/npm/pnpm/parse-lockfile'
```

(socket-lib's pnpm parser handles v5/v6/v9 dispatch internally — sdxgen's per-version split collapses into one entry point.)

The sdxgen test fixtures (`test/integration/<eco>/...`) stay put — they're now exercising socket-lib's path. CI on sdxgen catches any divergence between its expectations and socket-lib's output before v6.0.0 ships.

## What stays JS

- **socket-lib's TS port** (`src/eco/<eco>/parse-lockfile.ts`) — the JS fallback path for stock-Node consumers without the smol binary. Already exists.
- **The dispatcher** (`getSmolManifest()` in socket-lib). Already exists.
- **Reference impl in smol's `manifest.js`** — kept alive as the equivalence-suite oracle. Never the public surface again after v6.0.0.
- **sdxgen-owned ecosystems** not in this phase's native cut: maven, gradle, nuget, pypi, go, rubygems, packagist, swift, sbt, hex, conan, cocoapods, bun, vlt. These live in sdxgen TS until a later native-cut phase.

## What this is NOT

- Not a "first port it, then optimize" play. The plan only justifies its cost if we go straight to the optimized layout (arena + intern + bulk V8 transfer). A naive port hitting V8 round-trips per field will be slower than the JS impl on small inputs.
- Not reversible. Once socket-lib v6.0.0 ships and sdxgen migrates, regressing to a pure-JS impl regresses every consumer's perf characteristics. Plan accordingly — fuzz + equivalence suite at green status before tagging v6.0.0.
- Not free. The ~4000 lines of C++ is real ongoing cost. The bug-fix register above shows the rate of correctness work the parser surface attracts — every one of those fixes now goes through a smol rebuild.
- Not a complete sdxgen replacement. sdxgen retains ownership of every ecosystem not in the table above, and continues to be the algorithm oracle for the native-cut ecosystems too. We've narrowed sdxgen's role, not eliminated it.

## Open decisions before code lands

- **Bug-fix register completeness.** Section above lists 5 (1 deferred, 1 false-positive). Before step 1, confirm with the sdxgen owner that there are no additional fixes in flight that should be folded in. The QA pass that originated these caught what we found at that snapshot; sdxgen may have landed more since.
- **simdjson vendoring policy.** Single-header drop-in is the path of least resistance, but it commits us to syncing simdjson upgrades manually. Alternative: a thinner hand-rolled scanner for the npm v2/v3 case (which is a small subset of JSON). Decide before step 6.
- **Where the bench fixtures live.** Plan currently says `node-smol-builder/test/fixtures/`. Consider whether they should live in socket-sdxgen alongside its existing parser fixtures so the algorithm-of-record stays in one place. Leaning toward sdxgen.
- **isDev derivation tiebreaker** (Fix 5). Plan currently says "ties to `isDev: false`" — confirm against sdxgen's actual rule before coding. The npm-semantics tiebreak is intuitive but sdxgen's rule is the oracle.
