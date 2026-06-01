# updating-libdeflate Reference Documentation

This document provides edge cases, troubleshooting, and additional context for the updating-libdeflate skill.

## Table of Contents

- [Tag Format Reference](#tag-format-reference)
- [Cache Version Dependencies](#cache-version-dependencies)
- [Edge Cases](#edge-cases)
- [Rollback Procedures](#rollback-procedures)
- [Troubleshooting](#troubleshooting)

## Tag Format Reference

- Format: `vX.Y` or `vX.Y.Z` (e.g., `v1.25`, `v1.25.1`) - note two-part versions are common
- .gitmodules comment: `# libdeflate-X.Y` (strip `v` prefix, e.g., `# libdeflate-1.25`)
- Submodule path: `packages/binject/upstream/libdeflate`
- Upstream: `https://github.com/ebiggers/libdeflate.git`
- Exclude: Any tag with `rc`, `alpha`, `beta`

**Important:** libdeflate commonly uses two-part versions (e.g., `v1.25`) rather than three-part semver.

## Cache Version Dependencies

When updating libdeflate, bump these cache versions in `.github/cache-versions.json`:

```json
{
  "versions": {
    "binject": "v168",  // ← Bump this (binject uses libdeflate)
    "node-smol": "v191" // ← Bump this (node-smol uses binject)
  }
}
```

## Edge Cases

### Already on Latest Version

If already at latest, report "Already up to date" and exit without changes.

### Two-Part vs Three-Part Versions

libdeflate uses both `vX.Y` and `vX.Y.Z` formats. The .gitmodules comment should match the tag exactly (minus the `v` prefix). Don't add `.0` to two-part versions.

### Shared Submodule with cJSON

Both libdeflate and cJSON are under `packages/binject/upstream/`. If updating both simultaneously, bump `binject` and `node-smol` cache versions only once.

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

### Build Fails with Compression Errors

**Symptom:** `undefined reference to libdeflate_*`

**Cause:** API changed between versions (rare - libdeflate has a stable API).

**Solution:**
1. Check libdeflate changelog for breaking changes
2. Review binject's libdeflate usage for compatibility

### Submodule Dirty After Checkout

**Symptom:** `git status` shows modified content in libdeflate submodule

**Solution:**
```bash
cd packages/binject/upstream/libdeflate
git checkout -- .
git clean -fd
cd ../../../..
```
