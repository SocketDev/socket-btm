# updating-fast-webstreams Reference Documentation

This document provides edge cases, troubleshooting, and additional context for the updating-fast-webstreams skill.

## Table of Contents

- [Version Reference](#version-reference)
- [Cache Version Dependencies](#cache-version-dependencies)
- [Primordials Transforms](#primordials-transforms)
- [Edge Cases](#edge-cases)
- [Rollback Procedures](#rollback-procedures)
- [Troubleshooting](#troubleshooting)

## Version Reference

- npm package: `experimental-fast-webstreams` (Vercel)
- Version pinned in: `packages/node-smol-builder/package.json` (devDependencies)
- Vendor directory: `additions/source-patched/deps/fast-webstreams/`
- VERSION file: `additions/source-patched/deps/fast-webstreams/VERSION`
- WPT submodule in .gitmodules: `# wpt-epochs/three_hourly/YYYY-MM-DD_HHH`
- Not a git submodule - vendored from npm via sync script

## Cache Version Dependencies

When updating fast-webstreams, bump this cache version:

```json
{
  "versions": {
    "node-smol": "v191" // ← Bump this
  }
}
```

## Primordials Transforms

The sync script auto-applies these critical transforms (ES module to CommonJS with primordials):

| Original | Primordial |
|----------|-----------|
| `Object.create()` | `ObjectCreate()` |
| `Object.defineProperty()` | `ObjectDefineProperty()` |
| `Promise.resolve()` | `PromiseResolve()` |
| `Math.min()` | `MathMin()` |
| `array.map()` | `ArrayPrototypeMap(array, ...)` |
| `map.get()` | `MapPrototypeGet(map, ...)` |

Never modify vendored files manually - re-run sync instead.

## Edge Cases

### Circular Dependencies

Two known cycles require special handling in `sync.mts`:

1. **patch.js <-> index.js**: Import from source modules directly, not index.js
2. **writer.js <-> writable.js**: Use module reference pattern (access at runtime, not load time)

### WPT Submodule

The WPT tests use a sparse-checkout submodule. The `.gitmodules` tracks a WPT epoch tag (e.g., `epochs/three_hourly/2026-02-24_21H`). This is independent of the fast-webstreams version.

### No Changes After Sync

If the npm version hasn't changed, the sync produces no diff. Do not create an empty commit.

## Rollback Procedures

### Rollback After Commit

```bash
git reset --hard HEAD~1
```

### Rollback After Push

```bash
git revert HEAD
git push origin main
```

## Troubleshooting

### Cannot find module 'internal/deps/./file'

**Cause:** Relative path in require statement instead of absolute internal path.

**Solution:** The sync script should convert all paths. If missed, convert `./file` to `internal/deps/fast-webstreams/file`.

### _getDesiredSize is not a function

**Cause:** writer.js <-> writable.js circular dependency not handled.

**Solution:** Ensure `fixWriterWritableCycle()` is applied in sync.mts.

### Exports Missing After Require

**Cause:** Using `module.exports = {}` instead of individual `exports.X = X;` statements.

**Solution:** The sync script should use individual exports. If not, fix the sync script output format.

### WPT Tests Fail to Fetch

**Cause:** WPT submodule not initialized or epoch tag outdated.

**Solution:**
```bash
git submodule update --init packages/node-smol-builder/scripts/vendor-fast-webstreams/wpt/streams
```
