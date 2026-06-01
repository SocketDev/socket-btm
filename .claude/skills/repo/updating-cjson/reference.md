# updating-cjson Reference Documentation

This document provides edge cases, troubleshooting, and additional context for the updating-cjson skill.

## Table of Contents

- [Tag Format Reference](#tag-format-reference)
- [Cache Version Dependencies](#cache-version-dependencies)
- [Edge Cases](#edge-cases)
- [Rollback Procedures](#rollback-procedures)
- [Troubleshooting](#troubleshooting)

## Tag Format Reference

- Format: `vX.Y.Z` (e.g., `v1.7.18`)
- .gitmodules comment: `# cJSON-X.Y.Z` (strip `v` prefix, e.g., `# cJSON-1.7.15`)
- Submodule path: `packages/binject/upstream/cJSON`
- Upstream: `https://github.com/DaveGamble/cJSON.git`
- Exclude: Any tag with `rc`, `alpha`, `beta`

## Cache Version Dependencies

When updating cJSON, bump these cache versions in `.github/cache-versions.json`:

```json
{
  "versions": {
    "binject": "v168",  // ← Bump this (binject uses cJSON)
    "node-smol": "v191" // ← Bump this (node-smol uses binject)
  }
}
```

## Edge Cases

### Already on Latest Version

cJSON releases are infrequent. If already at latest, report "Already up to date" and exit without changes.

### cJSON API Stability

cJSON has a very stable API. Breaking changes are rare. The library is a single `cJSON.c`/`cJSON.h` pair, so build integration is straightforward.

### Version Comment Format

The .gitmodules comment uses the format `# cJSON-X.Y.Z` (with capital JSON), not `# cjson-X.Y.Z`. Match the existing convention.

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

### Build Fails with cJSON Errors

**Symptom:** `undefined reference to cJSON_*`

**Cause:** Unlikely given cJSON's stability, but possible if major version jump.

**Solution:**
1. Check cJSON changelog for breaking changes
2. Review binject's cJSON usage for compatibility

### Submodule Dirty After Checkout

**Symptom:** `git status` shows modified content in cJSON submodule

**Solution:**
```bash
cd packages/binject/upstream/cJSON
git checkout -- .
git clean -fd
cd ../../../..
```
