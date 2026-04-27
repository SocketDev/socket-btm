---
name: updating-stubs
description: Rebuilds self-extracting stub binaries after triggering curl update. Bumps stubs/binpress/node-smol caches. Use when stub binaries need refresh or after curl security patches.
user-invocable: true
allowed-tools: Skill, Bash(pnpm:*), Bash(npm:*), Bash(git:*), Bash(node:*), Bash(rg:*), Bash(grep:*), Bash(find:*), Bash(ls:*), Bash(cat:*), Bash(head:*), Bash(tail:*), Bash(wc:*), Bash(diff:*), Read, Edit, Glob, Grep---

# updating-stubs

Update stubs-builder by first updating curl (dependency), then rebuilding stubs.

- **Package**: `packages/stubs-builder/`
- **Dependency**: curl-builder (triggers `updating-curl` first)
- **Cache bumps**: `stubs`, `binpress`, `node-smol`

## Process

1. **Validate**: Clean working directory
2. **Update curl**: `Skill({ skill: "updating-curl" })` - wait for completion
3. **Rebuild stubs** (skip in CI): `pnpm run clean && pnpm run build` in `packages/stubs-builder`
4. **Test** (skip in CI): `pnpm test` in `packages/stubs-builder`
5. **Bump caches**: Increment `stubs`, `binpress`, `node-smol` in `.github/cache-versions.json`. Always bump if curl was updated.
6. **Commit** (if changes exist): Stage `packages/stubs-builder` and cache-versions.json
7. **Report**: Summary of curl update and stubs rebuild
