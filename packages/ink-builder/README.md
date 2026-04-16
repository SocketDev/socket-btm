# Prepatched Ink

This package provides a prepatched version of [Ink](https://github.com/vadimdemedes/ink) with Socket-specific fixes and optimizations.

## What's Included

### Patches Applied (`ink@6.3.1`)

1. **signal-exit import fix**: Changes the default import to named import for compatibility with modern ESM bundlers
   - `import signalExit from 'signal-exit'` → `import { onExit as signalExit } from 'signal-exit'`

2. **devtools removal**: Removes the conditional devtools import that uses top-level await, which causes bundling issues
   - Replaces dynamic devtools loading with a no-op function
   - Prevents `react-devtools-core` from being required as a dependency

### Bundled yoga-sync

The build rewires all `yoga-layout` imports to use socket-btm's synchronous yoga-sync:

- `import Yoga from 'yoga-layout'` → `import Yoga from './yoga-sync.mjs'`
- Bundles `yoga-sync.mjs` from `yoga-layout-builder/build/dev/out/Final/`
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

**Prerequisites**: Build yoga-layout-builder first:

```bash
cd ../yoga-layout-builder
pnpm run build
```

Then build ink:

```bash
pnpm run build
```

## Updating

When ink is updated upstream:

1. Update the version in `package.json` sources
2. Update the patch files in `patches/`
3. Verify `YOGA_IMPORT_FILES` list in `scripts/build.mjs` matches ink's imports
4. Rebuild and test

## Source

- Upstream: https://github.com/vadimdemedes/ink
- Version: 6.3.1
