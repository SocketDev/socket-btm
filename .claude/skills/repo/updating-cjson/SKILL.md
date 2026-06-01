---
name: updating-cjson
description: Updates cJSON submodule to latest stable version, bumps binject and node-smol caches. Use when cJSON has security patches, JSON parsing bugs, or as part of binject updates.
user-invocable: true
allowed-tools: Bash(pnpm:*), Bash(npm:*), Bash(git:*), Bash(node:*), Bash(rg:*), Bash(grep:*), Bash(find:*), Bash(ls:*), Bash(cat:*), Bash(head:*), Bash(tail:*), Bash(wc:*), Bash(diff:*), Read, Edit, Glob, Grep---

# updating-cjson

Update the cJSON library submodule (`packages/binject/upstream/cJSON`) to latest stable release.

- **Submodule**: `packages/binject/upstream/cJSON` (DaveGamble/cJSON)
- **Tag format**: `vX.Y.Z`
- **Cache bumps**: `binject`, `node-smol`

## Process

1. **Validate**: Clean working directory, detect CI mode
2. **Fetch latest**: `git fetch origin --tags` in submodule, find latest stable `vX.Y.Z` tag (exclude rc/alpha/beta)
3. **Check**: If already at latest, report and exit
4. **Update submodule**: `git checkout $TAG`
5. **Update .gitmodules**: Edit version comment to `# cJSON-X.Y.Z` (strip v prefix)
6. **Build/test** (skip in CI): `pnpm run clean && pnpm run build && pnpm test` in `packages/binject`
7. **Bump caches**: Increment `binject` and `node-smol` in `.github/cache-versions.json`
8. **Commit**: `git add .gitmodules packages/binject/upstream/cJSON .github/cache-versions.json`
9. **Report**: Summary with version change and cache bumps
