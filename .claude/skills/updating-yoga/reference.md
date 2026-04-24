# updating-yoga Reference Documentation

This document provides edge cases, troubleshooting, and additional context for the updating-yoga skill.

## Table of Contents

- [Version Reference](#version-reference)
- [Cache Version Dependencies](#cache-version-dependencies)
- [Wrapper Files Sync](#wrapper-files-sync)
- [Edge Cases](#edge-cases)
- [Rollback Procedures](#rollback-procedures)
- [Troubleshooting](#troubleshooting)

## Version Reference

- Version pinned in: `packages/yoga-layout-builder/package.json` under `sources.yoga`
- Also tracked as submodule in .gitmodules: `# yoga-X.Y.Z` (e.g., `# yoga-3.2.1`)
- Submodule path: `packages/yoga-layout-builder/upstream/yoga`
- Upstream: `https://github.com/facebook/yoga.git`
- Tags format: `vX.Y.Z` (e.g., `v3.2.1`)
- The `ref` field in package.json is a commit SHA
- Exclude: Any tag with `rc`, `alpha`, `beta`

## Cache Version Dependencies

When updating Yoga, bump this cache version:

```json
{
  "versions": {
    "yoga-layout": "v21" // ← Bump this
  }
}
```

**Note:** After updating Yoga, ink-builder should be rebuilt to pick up the new `yoga-sync.mjs`. Consider also bumping `ink` cache if yoga-sync output changed.

## Wrapper Files Sync

**Critical:** When updating Yoga, check if upstream wrapper files have changed:

| Local File | Upstream Source |
|-----------|---------------|
| `src/wrapper/YGEnums.mts` | `yoga/javascript/src/generated/YGEnums.ts` |
| `src/wrapper/wrapAssembly.mts` | `yoga/javascript/src/wrapAssembly.ts` |

After cloning new source, compare:
```bash
diff build/shared/source/javascript/src/generated/YGEnums.ts src/wrapper/YGEnums.mts
diff build/shared/source/javascript/src/wrapAssembly.ts src/wrapper/wrapAssembly.mts
```

Look for: new enum values, new patched methods, API signature changes, new exports.

## Edge Cases

### ink Dependency

ink depends on yoga-sync.mjs from yoga-layout-builder. If updating both Yoga and ink, update Yoga FIRST, rebuild, then update ink.

### External Tools Dependencies

Check `packages/yoga-layout-builder/external-tools.json` after updating. New Yoga versions may require newer cmake or emscripten.

### AST Transformation Breakage

The sync wrapper uses acorn + MagicString for AST-based code transformation. If upstream changes the structure of `wrapAssembly.ts` significantly, the transformation may fail. Check `generate-sync.mts` if build produces malformed output.

### Bindings Files

The build uses official C++ bindings from cloned source (`embind.cpp`, `Node.cpp`, `Config.cpp`). If these change structure, the build may fail with missing symbols.

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

### Sync Wrapper Missing Node.create()

**Cause:** wrapAssembly not applied correctly during AST transformation.

**Solution:** Check `generate-sync.mts` for transformation errors. Verify wrapAssembly.mts is up to date with upstream.

### Sync Wrapper Missing DIRECTION_LTR

**Cause:** YGEnums not inlined correctly.

**Solution:** Check that the constants object is aliased as `YGEnums` in the inlined output.

### Duplicate Export Errors

**Cause:** Multiple `export default` statements after inlining.

**Solution:** Verify AST transformation removes/converts exports properly in `generate-sync.mts`.

### ink Layout Broken After Update

**Symptom:** Terminal UI renders with wrong dimensions or alignment.

**Cause:** Yoga layout calculation behavior changed.

**Solution:**
1. Check Yoga changelog for layout behavior changes
2. Test ink package: `cd packages/ink-builder && pnpm test`
3. Rollback if layout regression confirmed
