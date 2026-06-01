---
name: updating-yoga
description: Updates the Facebook Yoga layout library to a new version — bumps sources.yoga + the lockstep pin, rebuilds the WASM module (which regenerates YGEnums.mts from the C++ header), and AI-assists the wrapAssembly.mts re-port when upstream's JS layer changed. Use for Yoga version bumps, Flexbox/layout fixes, or periodic yoga maintenance.
user-invocable: true
allowed-tools: Bash(pnpm:*), Bash(npm:*), Bash(git:*), Bash(node:*), Bash(rg:*), Bash(grep:*), Bash(find:*), Bash(ls:*), Bash(cat:*), Bash(head:*), Bash(tail:*), Bash(wc:*), Bash(diff:*), Read, Edit, Glob, Grep---

# updating-yoga

Update the Yoga layout library to latest stable version.

- **Version source**: `packages/yoga-layout-builder/package.json` under `sources.yoga`
- **Source**: Cloned from GitHub (not submodule) during build
- **Cache bumps**: `yoga-layout`
- **Downstream**: Rebuild downstream consumers (e.g. opentui-builder, node:smol-tui) to pick up the new yoga-sync.mjs

## Build Architecture

Produces the official yoga-layout npm API via WASM:
- Uses official `embind.cpp`, `Node.cpp`, `Config.cpp` bindings from upstream
- Wraps with `wrapAssembly.mts` for `Yoga.Node.create()`, `node.free()`, etc.
- Sync wrapper generation uses AST-based transforms (acorn + MagicString)

### Two wrapper surfaces, two maintenance models

`src/wrapper/` has two files with DIFFERENT upkeep on a yoga bump:

- **`YGEnums.mts` — GENERATED, zero manual work.** The build
  (`scripts/source-cloned/shared/generate-enums.mts`, run from
  `clone-source.mts`) regenerates it from `upstream/yoga/yoga/YGEnums.h`
  on every build. The header and the `embind.cpp` the WASM compiles from
  are the same pinned submodule checkout, so enum values can never drift
  from the binary's ABI. **Never hand-edit it; never diff it during an
  update.** A bump regenerates it automatically and the build re-stamps
  its `@ yoga <ver>` header.

- **`wrapAssembly.mts` — manual 1:1 re-port of FB's own JS layer.**
  Carries behavioral logic we deliberately do not reinvent: string-unit
  setters (`"100%"` / `"auto"`), measure/dirtied callback marshalling,
  and the JS-GC ↔ yoga-manual-alloc memory reconciliation
  (`Node.create`/`free`/`freeRecursive`, `Config.free`). Carries a
  `Lock-step from upstream: yoga/javascript/src/wrapAssembly.ts @ yoga
  <ver>` marker (build re-stamps the version). On a bump where upstream
  `wrapAssembly.ts` CHANGED, it needs a behavioral re-port — step 5.

## Process

1. **Validate**: Clean working directory, detect CI mode
2. **Fetch latest**: Query GitHub API for latest stable release and commit SHA
3. **Check**: If already at latest, report and exit
4. **Update package.json**: Edit `sources.yoga` (version, ref); update the
   `yoga` row's `pinned_sha` / `pinned_tag` in `.config/lockstep.json`.
5. **Reconcile the behavioral wrapper.** YGEnums needs nothing (the build
   regenerates it). For `wrapAssembly.mts`: diff upstream `wrapAssembly.ts`
   between the OLD and NEW yoga tags; if it changed, re-port the behavioral
   delta with the fleet locked-down agent + bump the lockstep `forked_at_sha`.
   Full recipe (diff command, `ai/spawn` + `AI_PROFILE.edit` call, smoke-test
   feedback loop, human-review gate): see [reference.md](reference.md) →
   "Wrapper Files Sync".
6. **Build/test** (skip in CI): `pnpm run clean && pnpm run build --force && pnpm test` in `packages/yoga-layout-builder`, then test ink integration. The build regenerates `YGEnums.mts`; if it changed, that's the new yoga's enums — commit it.
7. **Bump cache**: Increment `yoga-layout` in `.github/cache-versions.json`
8. **Commit**: Include package.json, lockstep.json, cache-versions.json, the regenerated `YGEnums.mts`, and any re-ported `wrapAssembly.mts`.
9. **Report**
