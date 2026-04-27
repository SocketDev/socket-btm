---
name: updating-curl
description: Updates curl and mbedtls submodules to latest stable versions, bumps curl/stubs/binpress/node-smol caches. Use for TLS security patches, HTTP client fixes, or periodic maintenance.
user-invocable: true
allowed-tools: Bash(pnpm:*), Bash(npm:*), Bash(git:*), Bash(node:*), Bash(rg:*), Bash(grep:*), Bash(find:*), Bash(ls:*), Bash(cat:*), Bash(head:*), Bash(tail:*), Bash(wc:*), Bash(diff:*), Read, Edit, Glob, Grep---

# updating-curl

Update curl and mbedtls submodules together to their latest stable releases.

- **curl submodule**: `packages/curl-builder/upstream/curl` (tag format: `curl-X_Y_Z`)
- **mbedtls submodule**: `packages/curl-builder/upstream/mbedtls` (tag format: `vX.Y.Z`)
- **Cache bumps**: `curl`, `stubs`, `binpress`, `node-smol`

## Process

1. **Validate**: Clean working directory, detect CI mode
2. **Fetch latest**: For both submodules, fetch tags and find latest stable (exclude rc/alpha/beta)
3. **Check**: If both already at latest, report and exit
4. **Update submodules**: `git checkout $TAG` for each
5. **Update .gitmodules**: Edit version comments (`# curl-X.Y.Z`, `# mbedtls-X.Y.Z`). Convert curl tag underscores to dots.
6. **Build/test** (skip in CI): `pnpm run clean && pnpm run build && pnpm test` in `packages/curl-builder`
7. **Bump caches**: Increment `curl`, `stubs`, `binpress`, `node-smol` in `.github/cache-versions.json`. Skip if no submodule changes.
8. **Commit**: Include `.gitmodules`, both submodule paths, and cache-versions.json
9. **Report**: Summary with version changes
