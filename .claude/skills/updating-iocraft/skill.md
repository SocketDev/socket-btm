---
name: updating-iocraft
description: Updates iocraft TUI library submodule to latest stable version, bumps iocraft cache. Use for terminal rendering fixes, new TUI features, or periodic maintenance.
user-invocable: true
allowed-tools: Bash, Read, Edit, Glob, Grep
---

# updating-iocraft

Update the iocraft TUI library submodule to latest stable release.

- **Submodule**: `packages/iocraft-builder/upstream/iocraft` (ccbrown/iocraft)
- **Tag format**: `iocraft-vX.Y.Z`
- **Cache bumps**: `iocraft`

## Process

1. **Validate**: Clean working directory, detect CI mode
2. **Fetch latest**: `git fetch origin --tags` in submodule, find latest stable `iocraft-vX.Y.Z` tag
3. **Check**: If already at latest, report and exit
4. **Update submodule**: `git checkout $TAG`, then `git checkout -- . && git clean -fd` to clean working tree
5. **Update .gitmodules**: Edit version comment to `# iocraft-X.Y.Z` (strip `iocraft-v` prefix)
6. **Build/test** (skip in CI): `pnpm run clean && pnpm run build && pnpm test` in `packages/iocraft-builder`
7. **Bump cache**: Increment `iocraft` in `.github/cache-versions.json`
8. **Commit and report**
