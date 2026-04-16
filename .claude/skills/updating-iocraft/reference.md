# updating-iocraft Reference Documentation

This document provides edge cases, troubleshooting, and additional context for the updating-iocraft skill.

## Table of Contents

- [Tag Format Reference](#tag-format-reference)
- [Cache Version Dependencies](#cache-version-dependencies)
- [Edge Cases](#edge-cases)
- [Rollback Procedures](#rollback-procedures)
- [Troubleshooting](#troubleshooting)

## Tag Format Reference

- Format: `iocraft-vX.Y.Z` (e.g., `iocraft-v0.7.18`) - note the `iocraft-` prefix
- .gitmodules comment: `# iocraft-X.Y.Z` (strip `iocraft-v` prefix, e.g., `# iocraft-0.7.18`)
- Submodule path: `packages/iocraft-builder/upstream/iocraft`
- Upstream: `https://github.com/ccbrown/iocraft.git`
- Exclude: Any tag with `rc`, `alpha`, `beta`

**Important:** The tag format uses a `iocraft-v` prefix (not just `v`). Use `git tag -l 'iocraft-v*.*.*'` to list versions.

## Cache Version Dependencies

When updating iocraft, bump this cache version:

```json
{
  "versions": {
    "iocraft": "v22" // ← Bump this
  }
}
```

iocraft is a leaf dependency for caching - no other cache keys depend on it.

## Edge Cases

### Already on Latest Version

If already at latest, report "Already up to date" and exit without changes.

### Submodule Dirty After Checkout

iocraft may have modified or untracked content after checkout. Always clean the submodule:

```bash
cd packages/iocraft-builder/upstream/iocraft
git checkout -- .
git clean -fd
cd ../../../..
```

### Rust Toolchain Requirements

iocraft builds native Node.js bindings via napi-rs (Rust). Ensure the Rust toolchain is installed and up to date for local builds.

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

### Build Fails with Rust Errors

**Symptom:** Compilation errors in Rust code

**Cause:** iocraft API changed or Rust toolchain outdated.

**Solution:**
1. Check iocraft changelog for breaking changes
2. Update Rust toolchain: `rustup update`
3. Review napi-rs binding code for compatibility

### Submodule Shows Modified Content

**Symptom:** `git status` shows `(modified content)` for iocraft submodule

**Solution:**
```bash
cd packages/iocraft-builder/upstream/iocraft
git checkout -- .
git clean -fd
cd ../../../..
```
