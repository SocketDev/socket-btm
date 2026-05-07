# updating-ink Reference Documentation

This document provides edge cases, troubleshooting, and additional context for the updating-ink skill.

## Table of Contents

- [Version Reference](#version-reference)
- [Cache Version Dependencies](#cache-version-dependencies)
- [Patch Details](#patch-details)
- [Edge Cases](#edge-cases)
- [Rollback Procedures](#rollback-procedures)
- [Troubleshooting](#troubleshooting)

## Version Reference

- Version pinned in: `packages/ink-builder/package.json` under `sources.ink`
- Source: `https://github.com/vadimdemedes/ink.git` (downloaded from npm, not submodule)
- Tags format: `vX.Y.Z` (e.g., `v6.3.1`)
- The `ref` field in package.json is a commit SHA, not a tag name
- Exclude: Any tag with `rc`, `alpha`, `beta`

## Cache Version Dependencies

When updating ink, bump this cache version:

```json
{
  "versions": {
    "ink": "v3" // ← Bump this
  }
}
```

ink is a leaf dependency for caching - no other cache keys depend on it.

## Patch Details

Patches are stored as a numbered series under
`packages/ink-builder/patches/` (per CLAUDE.md "Patch Rules" — one file
per patch, ordered numeric prefixes). Each applies one fix:

1. `001-ink-signal-exit-import.patch` — Convert `import signalExit from 'signal-exit'` to `import { onExit as signalExit } from 'signal-exit'`
2. `002-ink-remove-top-level-await-devtools.patch` — Remove dynamic devtools import to reduce bundle size

When updating to a new version, the patch files must be regenerated if
the patched source changed. They are version-agnostic filenames (no
`@X.Y.Z` suffix) — the current ink version lives in
`packages/ink-builder/package.json` `sources.ink.version`.

## Edge Cases

### yoga-layout-builder Must Be Built First

ink depends on `yoga-sync.mjs` from yoga-layout-builder. If updating both, run updating-yoga FIRST, then updating-ink.

Check yoga-sync exists:
```bash
ls packages/yoga-layout-builder/build/*/out/Final/yoga-sync.mjs
```

### Patch File Regeneration

Patch filenames are version-agnostic (`001-*.patch`, `002-*.patch`);
the patched ink version is tracked in `package.json`'s `sources.ink`.
When updating, regenerate the patches in place against the new ink
tarball — don't create new filenames.

### npm Tarball vs Git Clone

ink is downloaded from npm (pre-built JavaScript), NOT cloned from git. This avoids TypeScript build complexity. The `ref` in package.json is for reference only.

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

### Patch Fails to Apply

**Symptom:** `patch: **** FAILED` during build

**Cause:** Upstream changed the files that the patch modifies.

**Solution:** Regenerate the patch:
1. Extract fresh npm tarball
2. Copy to patched directory
3. Apply fixes manually to built JS files
4. Generate new diff

### Build Fails with yoga-sync Error

**Symptom:** `Cannot find module 'yoga-sync.mjs'`

**Cause:** yoga-layout-builder not built yet.

**Solution:** Build yoga-layout-builder first:
```bash
cd packages/yoga-layout-builder && pnpm run build
```

### signal-exit Import Error

**Symptom:** `signalExit is not a function`

**Cause:** Patch not applied or signal-exit API changed.

**Solution:** Verify patch applied correctly. Check if signal-exit updated its export signature.
