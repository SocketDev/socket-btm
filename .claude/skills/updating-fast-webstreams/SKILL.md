---
name: updating-fast-webstreams
description: Vendors fast-webstreams from npm to additions/, converting ESM to CommonJS with primordials for Node.js bootstrap. Use when the WebStreams version needs update or builds fail with streams errors.
user-invocable: true
allowed-tools: Bash, Read
---

# updating-fast-webstreams

Synchronize experimental-fast-webstreams from node_modules to the vendor directory, converting ES modules to CommonJS for Node.js internal module system.

Vercel's library replaces Node.js pure-JS WebStreams with native C++ stream-backed implementations (3-15x faster).

## Key Constraints

- Use absolute internal paths: `require('internal/deps/fast-webstreams/utils')` not `require('./utils.js')`
- Use individual `exports.X = X;` at file end (not `module.exports = {}`)
- The sync script handles ES-to-CJS conversion and primordials transforms automatically
- Do not modify converted files manually; re-run sync instead

## Process

### Sync

```bash
node packages/node-smol-builder/scripts/vendor-fast-webstreams/sync.mts
```

### Build (skip in CI)

```bash
pnpm --filter node-smol-builder clean && pnpm --filter node-smol-builder build
```

### Validate

Quick (15 tests): `node scripts/vendor-fast-webstreams/validate.mts`

Full WPT (1,116 tests): `node scripts/vendor-fast-webstreams/wpt/validate.mjs` (options: `--fetch`, `--filter=`, `--verbose`)

### Update Version

1. Edit `packages/node-smol-builder/package.json` devDependencies
2. `pnpm install`
3. Run sync, clean, rebuild, validate

## Circular Dependencies

Two cycles require special handling (managed by `sync.mts`):

- **patch.js <-> index.js**: Import directly from source modules, not index.js
- **writer.js <-> writable.js**: Use module reference pattern (access at runtime, not load time)

## Key Files

| File | Purpose |
|------|---------|
| `scripts/vendor-fast-webstreams/sync.mts` | ES-to-CJS conversion |
| `scripts/vendor-fast-webstreams/validate.mts` | 15-test integration suite |
| `scripts/vendor-fast-webstreams/wpt/validate.mjs` | WPT spec compliance |
| `additions/source-patched/deps/fast-webstreams/` | Converted CommonJS (14 files) |
