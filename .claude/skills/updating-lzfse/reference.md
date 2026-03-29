# updating-lzfse Reference Documentation

This document provides edge cases, troubleshooting, and additional context for the updating-lzfse skill.

## Table of Contents

- [Tag Format Reference](#tag-format-reference)
- [Cache Version Dependencies](#cache-version-dependencies)
- [Edge Cases](#edge-cases)
- [Rollback Procedures](#rollback-procedures)
- [Troubleshooting](#troubleshooting)

## Tag Format Reference

- Format: `lzfse-X.Y` (e.g., `lzfse-1.0`) - note the `lzfse-` prefix
- .gitmodules comment: `# lzfse-X.Y` (same as tag, e.g., `# lzfse-1.0`)
- Submodule path: `packages/lief-builder/upstream/lzfse`
- Upstream: `https://github.com/lzfse/lzfse.git`
- Exclude: Any tag with `rc`, `alpha`, `beta`

**Important:** LZFSE releases are very infrequent. The current version (`lzfse-1.0`) has been stable since 2017. Updates are rare.

## Cache Version Dependencies

When updating LZFSE, bump these cache versions in `.github/cache-versions.json`:

```json
{
  "versions": {
    "lief": "v61",      // ← Bump this (lief-builder uses LZFSE)
    "stubs": "v82",     // ← Bump this (stubs-builder uses LZFSE)
    "binpress": "v149", // ← Bump this (binpress embeds stubs)
    "node-smol": "v191" // ← Bump this (node-smol compressed with binpress)
  }
}
```

LZFSE has the widest cache impact - 4 cache keys must be bumped.

## Edge Cases

### Already on Latest Version

LZFSE has had only one release (`lzfse-1.0`). It is very likely already at the latest version. Check before proceeding.

### Submodule Located Under lief-builder

Unlike cJSON and libdeflate (under `packages/binject/`), LZFSE is under `packages/lief-builder/upstream/lzfse`. Don't confuse the paths.

### Wide Downstream Impact

LZFSE changes cascade through lief -> stubs -> binpress -> node-smol. Test thoroughly as failures may surface in downstream packages, not just lief-builder.

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

### Build Fails with LZFSE Errors

**Symptom:** `undefined reference to lzfse_*`

**Cause:** API changed (extremely unlikely given LZFSE's stability).

**Solution:**
1. Check lzfse repository for any breaking changes
2. Review lief-builder's LZFSE usage

### Stubs or Binpress Fail After LZFSE Update

**Symptom:** Downstream packages fail to build or produce corrupted output.

**Cause:** Compression format change or ABI incompatibility.

**Solution:**
1. Rebuild lief-builder first and verify
2. Then rebuild stubs, binpress, node-smol in order
3. Run full test suite for each
