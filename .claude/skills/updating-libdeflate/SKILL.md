---
name: updating-libdeflate
description: Updates libdeflate compression library submodule to latest stable version, bumps binject and node-smol caches. Use for compression performance improvements, bug fixes, or periodic maintenance.
user-invocable: true
allowed-tools: Bash, Read, Edit, Glob, Grep
---

# updating-libdeflate

Update the libdeflate library submodule to latest stable release.

- **Submodule**: `packages/binject/upstream/libdeflate` (ebiggers/libdeflate)
- **Tag format**: `vX.Y` or `vX.Y.Z`
- **Cache bumps**: `binject`, `node-smol`

## Process

1. **Validate**: Clean working directory, detect CI mode
2. **Fetch latest**: `git fetch origin --tags` in submodule, find latest stable `v*` tag
3. **Check**: If already at latest, report and exit
4. **Update submodule**: `git checkout $TAG`
5. **Update .gitmodules**: Edit version comment to `# libdeflate-X.Y` (strip v prefix)
6. **Build/test** (skip in CI): `pnpm run clean && pnpm run build && pnpm test` in `packages/binject`
7. **Bump caches**: Increment `binject` and `node-smol` in `.github/cache-versions.json`
8. **Commit and report**
