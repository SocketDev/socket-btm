# socket-btm architecture

Per-repo CLAUDE.md detail extracted to fit the 40KB whole-file cap. The CLAUDE.md `## 🏗️ BTM-Specific` section keeps the headline invariants; this file is the full surface. Deep technical references continue to live under `docs/references/btm-*.md`.

## Builder publish dispatch order

🚨 When re-publishing builder workflows after a registry/source SHA cascade, the order MUST be:

1. **curl + lief** — in PARALLEL (independent of each other).
2. **stubs** — AFTER curl AND lief are green at the new SHA (stubs links libcurl + uses lief).
3. **binsuite** — AFTER stubs is green.
4. **node-smol** — AFTER binsuite is green.

Never parallel-dispatch across tiers; parallel within a tier is fine. Bump `cache-versions.json` BEFORE re-dispatching or the cache key doesn't change. Out-of-order dispatch is gated by `scripts/repo/check-publish-prereq.mts` (runs as `verify-prereqs` in stubs.yml / binsuite.yml / node-smol.yml).

## Node.js Additions (`additions/` directory)

Code embedded into Node.js during early bootstrap. Constraints:

- No third-party packages — built-ins only. NEVER import from `@socketsecurity/*`.
- Use `require('fs')` not `require('node:fs')` — the `node:` protocol is unavailable at bootstrap.
- Start `.js` files with `'use strict';`. Use flat `.js` files (upstream convention), NEVER `index.js`-in-a-directory.
- `internalBinding` is already in scope — don't require it from `'internal/bootstrap/realm'`.
- All `node:smol-*` modules REQUIRE the `node:` prefix (enforced via `schemelessBlockList` in `lib/internal/bootstrap/realm.js`). Modules listed in [`docs/references/btm-glossary.md`](../../references/btm-glossary.md).
- Use primordials for Map/Set: `SafeMap`, `SafeSet`, `MapPrototypeGet/Set/Delete/Has`, `SetPrototypeAdd/Delete/Has`, `ArrayFrom`, `ObjectKeys`. `*Ctor` suffix for constructors shadowing globals (`BigIntCtor`, `ErrorCtor`). `.size` is safe on SafeMap/SafeSet. Prefer `ObjectKeys()` + indexed for-loop over `for...in` + `hasOwnProperty`.

### C++ rules

🚨 NEVER use C++ exceptions — Node.js compiles with `-fno-exceptions`; `std::bad_alloc` becomes `abort()` and kills the isolate. Allocations at JS entrypoints MUST use `new (std::nothrow) T(...)` + null-check + `isolate->ThrowException(...)`. STL containers have no nothrow escape — `.reserve(N)` upfront, cap user sizes before `.resize(n)`. `String::Utf8Value` — null-check `*utf8` before deref. Async libuv work must heap-allocate state and `delete` in the callback (callback does NOT fire on uv non-zero return — caller cleans up). Full `socketsecurity/...` include paths. Full patterns: [`docs/references/btm-additions-cpp.md`](../../references/btm-additions-cpp.md).

### SEA entry: require-from-VFS

Node 25.7+ replaces the ambient `require` inside a CJS SEA entry with embedder hooks that only resolve built-in names — external loads (file://, abs paths, VFS) fail with `ERR_UNKNOWN_BUILTIN_MODULE`. Always use `Module.createRequire(scriptPath)`; `createVFSRequire()` in `internal/socketsecurity/smol/bootstrap.js` already does this. Don't substitute `await import(pathToFileURL(...))` — same limitation applies.

## Source patches (Node.js, OpenTUI, LIEF)

🚨 **1 patch, 1 file. 1 file, 1 patch.** Bidirectional. Every source file in the patch series is owned by exactly one patch, and every patch modifies exactly one source file. No exceptions, no allowlist, no "intentional splits." Numbered series is contiguous — renumber when folding patches.

Standard unified diff (`--- a/`, `+++ b/`), NEVER `git format-patch`. Required headers on the first non-blank lines:

```diff
# @<project>-versions: vX.Y.Z     (or @opentui-versions / @lief-versions)
# @description: One-line summary
```

Locations, project-tag mapping, multi-file feature workflow, enforcement script details, and regeneration guidance: [`docs/references/btm-source-patches.md`](../../references/btm-source-patches.md). Related: `.claude/rules/gitmodules-version-comments.md`.

## Check gates

Every gate runs on `pnpm run check` and supports `--explain` / `--json`. Scripts: `check-version-consistency.mts`, `check-mirror-docs.mts`, `check-regression-patterns.mts`, `check-cascade-completeness.mts`, `check-patch-format.mts`. Full table in [`docs/references/btm-check-gates.md`](../../references/btm-check-gates.md).

## Build conventions & glossary

- Build system, toolchain alignment, source-of-truth, cache cascade, test style, npm-fetch, code style: [`docs/references/btm-build-conventions.md`](../../references/btm-build-conventions.md).
- Binary formats, build concepts, Node customization terms, `node:smol-*` listing, package names, ML/models lineup: [`docs/references/btm-glossary.md`](../../references/btm-glossary.md).
