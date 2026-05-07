---
name: updating-ink
description: Updates ink TUI framework from npm, regenerates patches for signal-exit and devtools fixes, bumps ink cache. Use for rendering fixes, React updates, or periodic maintenance. Run after updating-yoga.
user-invocable: true
allowed-tools: Bash(pnpm:*), Bash(npm:*), Bash(git:*), Bash(node:*), Bash(rg:*), Bash(grep:*), Bash(find:*), Bash(ls:*), Bash(cat:*), Bash(head:*), Bash(tail:*), Bash(wc:*), Bash(diff:*), Read, Edit, Glob, Grep---

# updating-ink

Update the ink TUI framework to latest stable version from npm.

- **Version source**: `packages/ink-builder/package.json` under `sources.ink`
- **Downloaded from**: npm registry (pre-built JavaScript, avoids TypeScript build)
- **Patches**: numbered series `packages/ink-builder/patches/{001-ink-signal-exit-import,002-ink-remove-top-level-await-devtools}.patch` (per CLAUDE.md "Patch Rules" — one file per patch, ordered numeric prefixes)
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
4. Generate per-fix diffs in the numbered series — each patch touches
   ONE file (per CLAUDE.md Patch Rules):
   - `001-ink-signal-exit-import.patch`
   - `002-ink-remove-top-level-await-devtools.patch`
5. Verify each patch applies cleanly to a fresh extract
