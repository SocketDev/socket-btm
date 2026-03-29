---
name: updating-ink
description: Updates ink TUI framework from npm, regenerates patches for signal-exit and devtools fixes, bumps ink cache. Use for rendering fixes, React updates, or periodic maintenance. Run after updating-yoga.
user-invocable: true
allowed-tools: Bash, Read, Edit, Glob, Grep
---

# updating-ink

Update the ink TUI framework to latest stable version from npm.

- **Version source**: `packages/ink-builder/package.json` under `sources.ink`
- **Downloaded from**: npm registry (pre-built JavaScript, avoids TypeScript build)
- **Patches**: `packages/ink-builder/patches/ink@X.Y.Z.patch`
- **Cache bumps**: `ink`
- **Dependency**: yoga-layout-builder must be built first (provides yoga-sync.mjs)

## Patches Applied

- `signal-exit` import: Convert default import to named `{ onExit as signalExit }`
- `devtools` disable: Remove dynamic devtools import for smaller bundle

## Process

1. **Validate**: Clean working directory, detect CI mode
2. **Check yoga**: Verify `yoga-sync.mjs` exists in yoga-layout-builder build output
3. **Fetch latest**: Query GitHub API for latest stable release, get commit SHA
4. **Check**: If already at latest, report and exit
5. **Update package.json**: Edit `sources.ink` (version, ref with commit SHA)
6. **Regenerate patch**: Download from npm, extract, copy to patched, apply fixes, generate diff
7. **Build/test** (skip in CI): `pnpm run clean && pnpm run build && pnpm test` in `packages/ink-builder`
8. **Bump cache**: Increment `ink` in `.github/cache-versions.json`
9. **Commit and report**

## Patch Regeneration

When updating to a new version:
1. Extract original: `tar -xzf ink-X.Y.Z.tgz`
2. Copy to patched directory
3. Apply signal-exit and devtools fixes to built JS files
4. Generate diff: `diff -ruN original patched > patches/ink@X.Y.Z.patch`
5. Verify patch applies cleanly to a fresh extract
