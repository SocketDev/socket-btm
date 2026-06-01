---
name: updating-checksums
description: Syncs SHA-256 checksums from GitHub releases to release-assets.json for offline build integrity verification. Use after publishing new releases or when offline builds fail checksum verification.
user-invocable: true
allowed-tools: Bash(pnpm:*), Bash(npm:*), Bash(git:*), Bash(node:*), Bash(rg:*), Bash(grep:*), Bash(find:*), Bash(ls:*), Bash(cat:*), Bash(head:*), Bash(tail:*), Bash(wc:*), Bash(diff:*), Read, Edit---

# updating-checksums

Sync SHA-256 checksums from GitHub releases to `packages/build-infra/release-assets.json`.

## Architecture

- `packages/build-infra/release-assets.json` - Embedded checksums (works offline)
- `packages/build-infra/lib/release-checksums.mts` - Verification logic
- `packages/build-infra/scripts/update-checksums.mts` - Sync script

Lookup priority: in-memory cache, then embedded checksums, then network fetch.

Tools with checksums: lief, curl, stubs, libpq, binpress, binflate, binject.

## Process

1. **Check current state**: `grep -E '"githubRelease"' packages/build-infra/release-assets.json`
2. **Sync**: `pnpm --filter build-infra update-checksums`
3. **Verify**: `git diff packages/build-infra/release-assets.json` and validate JSON
4. **Commit and push** (if changed):
   ```bash
   git add packages/build-infra/release-assets.json
   git commit -m "chore: update release checksums"
   git pull --rebase origin main
   git push origin main
   ```

Requires authenticated GitHub CLI (`gh auth status`).
