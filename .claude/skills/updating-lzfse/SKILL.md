---
name: updating-lzfse
description: Updates LZFSE Apple compression library submodule to latest stable version, bumps lief/stubs/binpress/node-smol caches. Use for compression improvements, platform compatibility, or periodic maintenance.
user-invocable: true
allowed-tools: Bash, Read, Edit, Glob, Grep
---

# updating-lzfse

Update the LZFSE compression library submodule to latest stable release.

- **Submodule**: `packages/lief-builder/upstream/lzfse` (lzfse/lzfse)
- **Tag format**: `lzfse-X.Y`
- **Cache bumps**: `lief`, `stubs`, `binpress`, `node-smol`

## Process

1. **Validate**: Clean working directory, detect CI mode
2. **Fetch latest**: `git fetch origin --tags` in submodule, find latest stable `lzfse-*` tag
3. **Check**: If already at latest, report and exit
4. **Update submodule**: `git checkout $TAG`
5. **Update .gitmodules**: Edit version comment to `# lzfse-X.Y` (keep original format)
6. **Build/test** (skip in CI): `pnpm run clean && pnpm run build && pnpm test` in `packages/lief-builder`
7. **Bump caches**: Increment `lief`, `stubs`, `binpress`, `node-smol` in `.github/cache-versions.json`
8. **Commit and report**
