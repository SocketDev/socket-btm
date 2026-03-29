---
name: updating-yoga
description: Updates Yoga layout library source, checks wrapper files for upstream changes, rebuilds WASM module, bumps yoga-layout cache. Use for layout bug fixes, Flexbox improvements, or periodic maintenance. Run before updating-ink.
user-invocable: true
allowed-tools: Bash, Read, Edit, Glob, Grep
---

# updating-yoga

Update the Yoga layout library to latest stable version.

- **Version source**: `packages/yoga-layout-builder/package.json` under `sources.yoga`
- **Source**: Cloned from GitHub (not submodule) during build
- **Cache bumps**: `yoga-layout`
- **Downstream**: After updating Yoga, run `updating-ink` to rebuild ink with new yoga-sync.mjs

## Build Architecture

Produces the official yoga-layout npm API via WASM:
- Uses official `embind.cpp`, `Node.cpp`, `Config.cpp` bindings from upstream
- Wraps with `wrapAssembly.mjs` for `Yoga.Node.create()`, `node.free()`, etc.
- Sync wrapper generation uses AST-based transforms (acorn + MagicString)

## Process

1. **Validate**: Clean working directory, detect CI mode
2. **Fetch latest**: Query GitHub API for latest stable release and commit SHA
3. **Check**: If already at latest, report and exit
4. **Update package.json**: Edit `sources.yoga` (version, ref)
5. **Check wrapper sync**: After cloning new source, compare upstream `YGEnums.ts` and `wrapAssembly.ts` against local `src/wrapper/` files. Update if significant changes detected (new enums, new patched methods).
6. **Build/test** (skip in CI): `pnpm run clean && pnpm run build --force && pnpm test` in `packages/yoga-layout-builder`, then test ink integration
7. **Bump cache**: Increment `yoga-layout` in `.github/cache-versions.json`
8. **Commit**: Include package.json, cache-versions.json, and any updated wrapper files
9. **Report**

## Wrapper Files

When updating, check for upstream changes:

- **YGEnums.mjs** (`src/wrapper/`): Compare with `yoga/javascript/src/generated/YGEnums.ts`. Look for new/removed enum values.
- **wrapAssembly.mjs** (`src/wrapper/`): Compare with `yoga/javascript/src/wrapAssembly.ts`. Look for new patched methods or API changes.
