# smol-manifest Native Tokenizer Plan

> **Status: Design — not yet implemented.** Today `node:smol-manifest` is pure JS in `packages/node-smol-builder/additions/source-patched/lib/internal/socketsecurity/manifest.js`. This plan scopes a targeted C++ acceleration layer for the two hot lockfile formats whose parsing is structural-text scanning (yarn classic, pnpm v5/v6/v9). The JS structural assembly stays put; only the inner line-tokenization loop moves to native.

## Why native (and why only here)

The current JS parsers fall into two perf classes:

1. **JSON-shaped lockfiles** — `package-lock.json` (npm v1/v2/v3), `Cargo.lock`'s TOML, yarn Berry's YAML. These hit `JSON.parse` / `TOML.parse` / `YAML.parse` and we're already at C++ speed. Nothing to win.
2. **Bespoke text formats** — yarn classic `yarn.lock` and pnpm `pnpm-lock.yaml`. Both are scanned line-by-line in JS with `String.prototype.indexOf` / `slice` / `startsWith` (primordialized). Every byte of the lockfile is touched by a JS frame.

Real pnpm/yarn lockfiles in monorepos run 50k–500k lines and dominate parser wall time. Moving the **tokenization** (line classification + key/value span extraction) to C++ buys us:

- 5–15x on the tokenizer step (no V8 string heap traffic; ASCII fast-path on raw `uint8_t*`).
- Cache locality — one pass over the bytes producing a packed token array, vs. N passes over JS string views.

We deliberately keep the **structural assembly** (building `PackageRef` objects, resolving peer suffixes, detecting workspace entries, classifying isDev) in JS. That logic is branchy, ecosystem-specific, and changes more often than the tokenizer. Splitting at the token boundary keeps the C++ surface small and the high-churn code in JS.

This is the same split that `node:smol-versions` ended up at (packed parsed form, JS owns range matching) and matches the working consensus in `packages/node-smol-builder/docs/plans/smol-versions-plan.md`'s "Shipped as JS-only" retrospective.

## Reference implementations

- `packages/node-smol-builder/additions/source-patched/lib/internal/socketsecurity/manifest.js` — current JS parsers (`parsePnpmLock`, `parseYarnLock`, `parseCargoLock`, `parsePackageLock`).
- `socket-lib/src/eco/npm/{pnpm,yarnpkg/yarn,npm}/parse-lockfile.ts` — TypeScript port, byte-for-byte equivalent fixtures.
- `packages/node-smol-builder/additions/source-patched/src/socketsecurity/versions/` — proven C++-binding layout we'll mirror (header / impl / N-API surface in `*_binding.cc`).

## Scope

**In scope:**

- yarn classic v1 `yarn.lock` tokenizer
- pnpm v5/v6/v9 `pnpm-lock.yaml` tokenizer
- A single shared scanner producing a packed `Token[]` consumed by JS

**Out of scope (stay JS):**

- npm `package-lock.json` (JSON.parse fast enough)
- yarn Berry (YAML.parse + structured walk)
- Cargo `Cargo.lock` (TOML.parse fast enough)
- All structural assembly (`PackageRef` construction, peer suffix stripping, dep-classification)
- All v6 ecosystem additions in `socket-lib/src/eco/` (those route through the same dispatcher, so they benefit transparently when smol is present)

## Performance budget

Target: **5–10x** on the tokenizer phase for yarn + pnpm.

Measurement plan (must land before merging the C++ path):

1. Bench fixture: real `pnpm-lock.yaml` from a 200-package monorepo (~80k lines) + real `yarn.lock` from a 600-package monorepo (~120k lines).
2. Two timed paths: `parsePnpmLock(content)` JS-only vs. JS+native via `getSmolManifestNative()`.
3. Pass criterion: native ≥ 5x faster on the tokenizer-dominated subset (`scanLines` invocation in isolation), no measurable regression on small lockfiles (< 1k lines).

If we don't hit 5x, the C++ path doesn't ship. Pure-JS is the floor we maintain.

## C++ Architecture

### Header: `src/socketsecurity/manifest/manifest_tokenizer.h`

```cpp
// node:smol-manifest — line tokenizer for yarn / pnpm lockfile formats.
//
// Single-pass scanner: walks the input byte-by-byte (ASCII fast path)
// and emits a packed token stream that JS consumes to assemble
// PackageRef objects. Does NOT build any structured output itself.

#ifndef SRC_SOCKETSECURITY_MANIFEST_MANIFEST_TOKENIZER_H_
#define SRC_SOCKETSECURITY_MANIFEST_MANIFEST_TOKENIZER_H_

#if defined(NODE_WANT_INTERNALS) && NODE_WANT_INTERNALS

#include <cstdint>
#include <cstddef>
#include <vector>

namespace node {
namespace socketsecurity {
namespace manifest {

// Format selector — the tokenizer's two formats are similar (indent
// matters, `key:` and `key: value` lines) but classify lines
// differently. yarn allows quoted key heads and multi-key lines; pnpm
// has anchors (`/<name>/<version>:`) and importer sub-headers.
enum class Format : uint8_t {
  kYarn = 0,
  kPnpm = 1,
};

// Token kinds — coarse enough that the JS side does the rest. Each
// kind maps to a stable u8; the JS side uses a frozen const-enum to
// dispatch on it.
enum class TokenKind : uint8_t {
  kBlankLine = 0,      // ignored by JS, kept for line-counting
  kComment = 1,        // `#` line; ignored but emitted for fidelity
  kHeaderLine = 2,     // top-level `packages:` / `importers:` etc.
  kEntryHead = 3,      // yarn `"foo@^1, foo@^2":` or pnpm `/foo/1.0.0:`
  kKeyValue = 4,       // indented `key: value` line
  kKeyOnly = 5,        // indented `key:` line (block follows)
  kListItem = 6,       // indented `- value` line
  kUnknown = 7,        // failed to classify; JS treats as kBlankLine
};

// One token = 28 bytes (cache-line friendly).
struct Token {
  uint32_t lineStart;   // byte offset of line start in input
  uint32_t lineEnd;     // byte offset of LF (exclusive)
  uint32_t keyStart;    // byte offset of key start, or UINT32_MAX
  uint32_t keyEnd;      // byte offset of key end (exclusive)
  uint32_t valueStart;  // byte offset of value start, or UINT32_MAX
  uint32_t valueEnd;    // byte offset of value end (exclusive)
  uint16_t indent;      // leading-space count (clamped to UINT16_MAX)
  uint8_t kind;         // TokenKind
  uint8_t flags;        // bit 0: quoted-key, bit 1: trailing-comma list
};
static_assert(sizeof(Token) == 28, "Token must stay compact");

// Scan `data[0..size)` and append tokens to `out`. Returns number of
// tokens appended. Caller pre-reserves `out` to roughly `size / 32` for
// typical lockfiles. Never throws; malformed lines emit kUnknown.
size_t ScanLines(const uint8_t* data,
                 size_t size,
                 Format format,
                 std::vector<Token>* out);

}  // namespace manifest
}  // namespace socketsecurity
}  // namespace node

#endif  // NODE_WANT_INTERNALS
#endif  // SRC_SOCKETSECURITY_MANIFEST_MANIFEST_TOKENIZER_H_
```

### Impl: `src/socketsecurity/manifest/manifest_tokenizer.cc`

Single function `ScanLines`. Walks `data` with a simple state machine:

1. Find next LF; record `[lineStart, lineEnd)`.
2. Count leading spaces → `indent`.
3. If first non-space is `#` → `kComment`, continue.
4. If line is empty after trim → `kBlankLine`, continue.
5. Look for unquoted `:`; if missing → `kListItem` (when leading `- `) / `kUnknown`.
6. Split at `:`. If RHS is empty (or only whitespace + trailing comma) → `kKeyOnly`; else → `kKeyValue`.
7. Format-specific overrides for `kEntryHead`:
   - yarn: `indent == 0` AND key contains `@` (after unquoting) → `kEntryHead`.
   - pnpm: `indent == 2` AND key starts with `/` AND ends with `:` (no value) → `kEntryHead`.
8. Header pass: `indent == 0` and key is one of `{packages, importers, snapshots, dependencies, devDependencies, optionalDependencies, peerDependencies, lockfileVersion, ...}` → flip `kHeaderLine`.

No regex, no allocation per line (everything is offsets into the input buffer). The hot loop is straight C reading `uint8_t*`.

### Binding: `src/socketsecurity/manifest/manifest_binding.cc`

Exposes one method to JS:

```cpp
// Signature: scanLines(input: Buffer | string, format: number) -> Uint32Array
//
// Returns a flat Uint32Array of N * 7 entries (Token packed without
// the 2-byte tail, padded to a u32 boundary):
//   [lineStart, lineEnd, keyStart, keyEnd, valueStart, valueEnd, packed]
// where packed = (indent << 16) | (flags << 8) | kind
//
// JS side wraps this in a typed view; no string allocation occurs in
// the binding.
```

Two notes:

- **Input as Buffer**: JS passes `Buffer.from(content, 'utf8')` once; the binding reads bytes directly. Avoids the V8 string-pair → utf8 conversion cost we'd otherwise pay on every line.
- **Output as Uint32Array**: a single ArrayBuffer allocation, sized exactly to `tokenCount * 7 * 4`. JS reads it without per-token object construction.

Registered as `smol_manifest_native` (per the existing naming pattern: `smol_versions_native`, `smol_util`, `smol_webstreams`).

## JS integration

### New facade: `lib/internal/socketsecurity/smol-manifest-native.js`

```js
'use strict'

const binding = internalBinding('smol_manifest_native')

const FORMAT_YARN = 0
const FORMAT_PNPM = 1

const KIND_BLANK = 0
const KIND_COMMENT = 1
const KIND_HEADER = 2
const KIND_ENTRY_HEAD = 3
const KIND_KEY_VALUE = 4
const KIND_KEY_ONLY = 5
const KIND_LIST_ITEM = 6
const KIND_UNKNOWN = 7

// 7 u32 per token.
const STRIDE = 7

function scanYarn(content) {
  return binding.scanLines(content, FORMAT_YARN)
}

function scanPnpm(content) {
  return binding.scanLines(content, FORMAT_PNPM)
}

module.exports = {
  STRIDE,
  KIND_BLANK,
  KIND_COMMENT,
  KIND_HEADER,
  KIND_ENTRY_HEAD,
  KIND_KEY_VALUE,
  KIND_KEY_ONLY,
  KIND_LIST_ITEM,
  KIND_UNKNOWN,
  scanYarn,
  scanPnpm,
}
```

### Refactor: `manifest.js` line-walk → token-walk

`parsePnpmLock` and `parseYarnLock` currently look like:

```js
const lines = StringPrototypeSplit(content, '\n')
for (let i = 0; i < lines.length; i++) {
  const line = lines[i]
  const indent = indentOf(line)
  // ...classify and dispatch
}
```

They become:

```js
const native = require('internal/socketsecurity/smol-manifest-native')
const buf = Buffer.from(content, 'utf8')
const tokens = native.scanPnpm(buf)
for (let i = 0; i < tokens.length; i += native.STRIDE) {
  const lineStart = tokens[i]
  const lineEnd = tokens[i + 1]
  const keyStart = tokens[i + 2]
  // ...
  const kind = tokens[i + 6] & 0xff
  const indent = tokens[i + 6] >>> 16
  // Substring extraction is now indexed on the buffer:
  const key = buf.toString('utf8', keyStart, keyEnd)
  // ...
}
```

The structural assembly (cycle detection, peer-suffix stripping, dep-classification, isDev derivation) stays untouched. Only the **classification loop** changes.

### Dispatcher: `lib/smol-manifest.js`

The existing `getSmolManifest()` dispatcher in socket-lib remains the entry point. Internally, the native fast path replaces the inner loop:

```js
const native = process.smol?.manifestNative
const parsePnpmLock = native
  ? (content) => parsePnpmLockNative(content, native)
  : parsePnpmLockJs
```

socket-lib's `src/eco/npm/pnpm/parse-lockfile.ts` already routes via `getSmolManifest()`; nothing changes downstream.

## Patches to edit

The build pipeline already has three relevant patches; add the manifest sources to each.

### `004-node-gyp-smol-sources.patch` — add to `node.gyp` sources list

Insert after the existing `versions/` entries:

```diff
             'src/socketsecurity/versions/versions.cc',
             'src/socketsecurity/versions/versions_binding.cc',
+            'src/socketsecurity/manifest/manifest_tokenizer.cc',
+            'src/socketsecurity/manifest/manifest_binding.cc',
```

### `017-smol-builtin-bindings.patch` — register binding name

Add to the `V(...)` macro list (alphabetical order — between `smol_http` and `smol_postgres`, or wherever fits):

```diff
   V(smol_versions_native)                                                      \
+  V(smol_manifest_native)                                                      \
```

### `019-smol-external-refs.patch` — register external-reference allowlist

Same insertion as above so the symbol survives `--use-largepages` / snapshot serialization.

### New addition: `lib/internal/socketsecurity/smol-manifest-native.js`

Drop alongside the existing `manifest.js`. It's the JS-side wrapper described under _New facade_ above.

### Edit existing: `lib/internal/socketsecurity/manifest.js`

Two functions change shape: `parsePnpmLock`, `parseYarnLock`. Body becomes the token-walk shown under _Refactor_. The other three parsers (`parsePackageLock`, `parseCargoLock`, `parseYarnBerryLock`) stay byte-for-byte identical — they don't use the tokenizer.

## Testing

`test/smol-manifest.test.mts` already covers the JS parsers. The native path must pass the same suite untouched — that's the correctness oracle.

Add a new sequential suite at the bottom that **forces** the native path on smol builds and asserts:

1. **Equivalence**: `parsePnpmLock(content)` produces deep-equal output to the JS-only fallback for ~20 real-world lockfile fixtures. (Fixtures already collected from sdxgen + coana QA pass — reuse them.)
2. **Tokenizer fuzz**: 1000 randomly-generated near-valid lines fed to `scanPnpm` / `scanYarn`; check no crashes and that round-tripping (token → substring extraction → re-classify in JS) is idempotent.
3. **Perf assertion**: on the 80k-line fixture, native path is at least 5x faster than JS path. Skipped on non-smol builds.

The 6 alignment-with-sdxgen tests added in the previous bug-fix pass continue to gate both paths.

## Risk + mitigations

- **Risk: native + JS divergence.** Mitigation: equivalence suite (1) above is mandatory on every smol build; native code never gets to drift from JS because every JS test runs against both paths in CI.
- **Risk: encoding edge cases.** Real lockfiles are pure ASCII for keys but values can include UTF-8 (package descriptions, URLs). The tokenizer never decodes — it only finds offsets. UTF-8 just rides through as opaque bytes; JS does the substring decode. No risk.
- **Risk: build verification gap.** I can't build the smol binary in-session. Mitigation: design doc lands first (this file), then a follow-up PR adds the C++ source + patches with a green CI run on socket-btm before any socket-lib changes ride.
- **Risk: small-lockfile regression.** Adding a Buffer round-trip costs ~5–20µs per call. Mitigation: keep the JS path as the implementation for inputs < 8KB; the dispatcher checks `content.length` and skips the binding for small lockfiles.

## Sequencing

1. **This doc** — agree on shape.
2. **C++ tokenizer** — `manifest_tokenizer.{h,cc}` + unit tests in a host C++ runner if we have one; otherwise covered by the JS equivalence suite.
3. **Binding** — `manifest_binding.cc`.
4. **JS facade + dispatcher wiring** — `smol-manifest-native.js` + `manifest.js` refactor.
5. **Patches** — `004`, `017`, `019` edits.
6. **Benchmarks** — must hit the 5x bar; otherwise revert to JS-only.
7. **socket-lib** — no changes needed; it routes through `getSmolManifest()` and benefits transparently.

## Decision points (still open)

- **Bench fixture provenance**: do we ship a fixture in `node-smol-builder/test/fixtures/` or fetch real lockfiles from a public monorepo at test-time? Leaning toward shipping (deterministic; no network in CI).
- **Buffer vs. string input**: I've specced Buffer to avoid the JS string → utf8 hop, but if the call sites already have a string in hand (they do — `fs.readFileSync(path, 'utf8')`), the Buffer conversion adds a copy. Benchmark both before committing.
- **Token kind for pnpm `snapshots:` sub-section**: today the JS parser uses indent + section state to know whether `/foo/1.0.0:` is an importer entry or a snapshot. Either the tokenizer tracks section state (it would need to) or JS does (cleaner — keeps the tokenizer pure). Leaning toward JS-tracks.

## What this is NOT

- Not a rewrite of `node:smol-manifest`. The JS body of `manifest.js` keeps its current shape; only the inner loop changes.
- Not a port of the structural assembly. Bug fixes (workspace+alias preference, npm v1 alias, pnpm v9 empty-version, yarn dependenciesMeta, workspace/file filter) live in the JS body and stay there.
- Not a perf gamble. If the 5x target doesn't hit on real fixtures, this whole layer doesn't ship; the JS path is already correct and acceptable for typical workloads.
