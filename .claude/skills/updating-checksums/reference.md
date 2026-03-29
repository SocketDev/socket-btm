# updating-checksums Reference Documentation

This document provides edge cases, troubleshooting, and additional context for the updating-checksums skill.

## Table of Contents

- [Architecture](#architecture)
- [Tools with Checksums](#tools-with-checksums)
- [Edge Cases](#edge-cases)
- [Rollback Procedures](#rollback-procedures)
- [Troubleshooting](#troubleshooting)

## Architecture

- Embedded checksums: `packages/build-infra/release-assets.json`
- Verification logic: `packages/build-infra/lib/release-checksums.mjs`
- Update script: `packages/build-infra/scripts/update-checksums.mjs`

Embedded checksums are the source of truth. Verification rejects if checksums exist for the tool but not the asset.

## Tools with Checksums

| Tool | Description |
|------|-------------|
| lief | LIEF binary manipulation library |
| curl | curl with mbedTLS |
| stubs | Self-extracting stub binaries |
| libpq | PostgreSQL client library |
| binpress | Binary compression tool |
| binflate | Binary decompression tool |
| binject | Binary injection tool |

## Edge Cases

### No Cache Version Bump Needed

Checksum syncing does NOT require bumping any cache versions in `.github/cache-versions.json`. Checksums are metadata only - they don't affect build artifacts.

### Partial Sync Failures

If some tools sync but others fail (e.g., a release doesn't exist yet):
- The script continues with remaining tools
- Review output for "Summary: X updated, Y unchanged, Z failed"
- Re-run with `--tool=<name>` for failed tools after the release is published

### No Changes After Sync

If all checksums match, `release-assets.json` will be unchanged. Do not create an empty commit.

### New Tool Added

When a new tool is added to the release pipeline, the sync script auto-discovers it. No manual configuration needed.

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

### Sync Script Fails with Auth Error

**Symptom:** `gh: Not logged into any GitHub hosts`

**Solution:** Run `gh auth login` or set `GITHUB_TOKEN` environment variable.

### Release Not Found

**Symptom:** `release not found for <tool>`

**Cause:** Release hasn't been published yet, or tag name changed.

**Solution:** Verify release exists: `gh release list --repo SocketDev/socket-btm`

### Invalid JSON After Sync

**Symptom:** JSON parse error on `release-assets.json`

**Solution:** The sync script validates JSON before writing. If corruption occurs, restore with `git checkout packages/build-infra/release-assets.json` and re-run.
