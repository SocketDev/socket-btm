# Prepatched Ink

This package provides a prepatched version of [Ink](https://github.com/vadimdemedes/ink) with Socket-specific fixes and optimizations.

## What's Included

### Patches Applied (`ink@7.0.0`)

1. **signal-exit import fix**: Changes the default import to named import for compatibility with modern ESM bundlers
   - `import signalExit from 'signal-exit'` → `import { onExit as signalExit } from 'signal-exit'`

2. **devtools removal**: Removes the conditional devtools import that uses top-level await, which causes bundling issues
   - Replaces dynamic devtools loading with a no-op function
   - Prevents `react-devtools-core` from being required as a dependency

### Bundled yoga-sync

The build rewires all `yoga-layout` imports to use socket-btm's synchronous yoga-sync:

- `import Yoga from 'yoga-layout'` → `import Yoga from './yoga-sync.mjs'`
- Bundles `yoga-sync.mjs` from yoga-layout-builder's prod (or dev) Final dir; the exact path comes from `yoga-layout-builder/scripts/paths.mts` `getBuildPaths().outputSyncMjsFile`
- Removes `yoga-layout` from dependencies (no external yoga dependency needed)

This provides:

- Synchronous WASM instantiation (no async loading)
- Embedded WASM binary (no separate .wasm file to load)
- Optimized build from yoga-layout-builder

## Output

The `dist/` directory contains the complete ink package ready to use:

- All ink source files with patches applied
- `build/yoga-sync.mjs` - Bundled synchronous yoga layout engine
- `package.json` with `yoga-layout` dependency removed

## Building

Build `yoga-layout-builder` first so its `yoga-sync.mjs` is on disk:

```bash
pnpm --filter yoga-layout-builder run build
pnpm --filter ink-builder run build
```

Output: `packages/ink-builder/dist/` — the complete patched ink package, ready to consume via the workspace.

## Updating

When ink is updated upstream:

1. Bump `sources.ink.version` and `sources.ink.ref` in `package.json` (the `ref` is the commit SHA the tarball pulls from)
2. Update the patch files in `patches/`
3. Verify `YOGA_IMPORT_FILES` list in `scripts/build.mts` matches ink's imports
4. Rebuild and test

## Source

- Upstream: https://github.com/vadimdemedes/ink
- Version: 7.0.0
