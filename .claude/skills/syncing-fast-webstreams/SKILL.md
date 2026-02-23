---
name: syncing-fast-webstreams
description: Syncs experimental-fast-webstreams vendor from node_modules to additions/, converting ES modules to CommonJS. Use when updating fast-webstreams version, after vendor directory cleanup, or when build fails with WebStreams errors.
user-invocable: true
disable-model-invocation: false
allowed-tools: Bash, Read
---

# syncing-fast-webstreams

<task>
Synchronize experimental-fast-webstreams from node_modules to the vendor directory, converting ES modules to CommonJS for Node.js internal module system.
</task>

<context>
## Why fast-webstreams?

Vercel's library replaces Node.js pure-JS WebStreams with native C++ stream-backed implementations:

| Operation | Speedup |
|-----------|---------|
| pipeThrough (transforms) | 11× faster |
| Byte streams (start+enqueue) | 14.7× faster |
| Read loops | 3.8× faster |
| Transform chains (8×) | 8.6× faster |

## Architecture Tiers

- **Tier 0 (Pipeline)**: Chains of Fast streams use Node.js `pipeline()` with zero Promise allocations per chunk
- **Tier 1 (Sync Fast Path)**: `reader.read()` returns `Promise.resolve()` synchronously when data is buffered
- **Tier 2 (Native Interop)**: Falls back to full WHATWG spec for custom strategies

## Why Vendor?

- `additions/` runs during Node.js early bootstrap before npm is available
- Library is ES modules; additions/ requires CommonJS
- Package is devDependency for taze updates and grace period tracking
</context>

<constraints>
**CRITICAL:**
- Package must be installed via `pnpm install` first
- Use absolute internal paths: `require('internal/deps/fast-webstreams/utils')` NOT `require('./utils.js')`
- Use individual `exports.X = X;` at file end (NOT `module.exports = {}`)
- Fix circular dependencies using module reference pattern

**Do NOT:**
- Use relative paths in require (Node.js internal loader prepends `internal/deps/` making `./file` invalid)
- Use `module.exports = {}` (breaks circular deps - other modules hold reference to OLD exports object)
- Destructure from circular dependency modules at module load time
- Modify converted files manually (re-run sync instead)
</constraints>

## Instructions

### Sync to Latest Version

```bash
# From packages/node-smol-builder directory
node scripts/vendor-fast-webstreams/sync.mjs
```

### Build

```bash
# From monorepo root
pnpm --filter node-smol-builder clean && pnpm --filter node-smol-builder build
```

### Validate (Quick - 15 tests)

Run integration suite against built binary:
```bash
node scripts/vendor-fast-webstreams/validate.mjs
```

Tests: globals, ReadableStream, WritableStream, TransformStream, pipeTo, pipeThrough, byte streams, tee, Response, async iteration.

### Validate WPT (Full - 1,116 tests)

Run WHATWG Streams spec compliance tests:
```bash
node scripts/vendor-fast-webstreams/wpt/validate.mjs
```

Options:
- `--fetch` - Force re-fetch WPT tests
- `--filter=readable-streams` - Run subset
- `--verbose` - Show all error details

Tests are sparse-fetched on-demand from WPT repo at SHA tracked in `.gitmodules`.

### Update Version

1. Edit `packages/node-smol-builder/package.json` devDependencies
2. Run `pnpm install`
3. Run sync script
4. Clean and rebuild
5. Run validate script

## Circular Dependencies

Two cycles require special handling in `sync.mjs`:

### patch.js ↔ index.js
**Fix**: Import directly from source modules, not index.js:
```javascript
const { FastReadableStream } = require('internal/deps/fast-webstreams/readable')
const { FastTransformStream } = require('internal/deps/fast-webstreams/transform')
const { FastWritableStream } = require('internal/deps/fast-webstreams/writable')
```

### writer.js ↔ writable.js
**Fix**: Use module reference pattern (access at runtime, not load time):
```javascript
// Don't destructure at top level
const _writable = require('internal/deps/fast-webstreams/writable')

// Access at runtime when functions are called
_writable._getDesiredSize(stream)
_writable._abortInternal(...)
```

## Troubleshooting

| Error | Fix |
|-------|-----|
| `Cannot find module 'internal/deps/./file'` | Convert relative path to absolute: `internal/deps/fast-webstreams/file` |
| `_getDesiredSize is not a function` | Apply `fixWriterWritableCycle()` in sync.mjs |
| `X is not a function` at load | Use module reference pattern instead of destructuring |
| Exports missing after require | Use `exports.X = X;` not `module.exports = {}` |

## Files

| File | Purpose |
|------|---------|
| `scripts/vendor-fast-webstreams/sync.mjs` | ES→CJS conversion with circular dep fixes |
| `scripts/vendor-fast-webstreams/validate.mjs` | 15-test integration suite |
| `scripts/vendor-fast-webstreams/wpt/validate.mjs` | WPT spec compliance (1,116 tests) |
| `scripts/vendor-fast-webstreams/wpt/harness.mjs` | WPT testharness.js polyfill |
| `additions/source-patched/deps/fast-webstreams/` | Converted CommonJS (14 files) |
| `additions/source-patched/deps/fast-webstreams/VERSION` | Version tracking |
| `additions/source-patched/lib/internal/socketsecurity/polyfills/fast-webstreams.js` | Bootstrap integration |
| `patches/source-patched/015-fast-webstreams.patch` | Loads fast-webstreams at bootstrap |

## Success Criteria

- VERSION file shows correct version and sync timestamp
- All 14 JS files present in vendor directory
- Build completes without errors
- Quick validation: 15/15 tests pass
- WPT validation: See pass rates below

## WPT Pass Rates

| Implementation | Passed | Failed | Pass Rate |
|----------------|--------|--------|-----------|
| Native Node 25 | 1099 | 17 | 98.5% |
| fast-webstreams | 1099 | 17 | 98.5% |

The 17 failures match native Node 25 exactly:

**Not implemented:**
- `owning` type (5) - not implemented in Node.js

**Tee implementation differences (8):**
- Constructor monkey-patching doesn't work with Fast's tee architecture

**Shared with native (4):**
- AsyncIteratorPrototype cross-realm (1)
- BYOB cancel/templated (2)
- Subclassing (1)
