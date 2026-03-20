Regenerate Node.js patches from pristine source using the regenerating-node-patches skill.

Usage:

- `/node-patcher` - Regenerate all 16 patches
- `/node-patcher 005` - Regenerate only patch 005

If a patch number is provided (e.g., "005"), use the Skill tool to invoke the `regenerating-node-patches` skill with instructions to ONLY regenerate that specific patch. Skip the backup and cleanup steps for single-patch mode.

If no patch number is provided, regenerate all patches with full workflow:

1. Backup existing patches with timestamp
2. Reset upstream node submodule to SHA in .gitmodules
3. Clean build artifacts and working directory
4. Regenerate all 16 patches from pristine Node.js v25.5.0 source
5. Validate each patch with dry-run before persisting

The skill follows this workflow for each patch:

- Obtain pristine file from Node.js v25.5.0
- Apply modifications based on existing patch
- Generate new patch using `diff -u` (NOT git diff)
- Validate with `patch --dry-run`
- Persist to patches directory

Report back when complete with summary of patches regenerated.

## Parameter Validation

**Valid patch numbers:** 001-014, 016-017

If a patch number is provided, validate it matches the pattern `NNN` where N is a digit:

- 001: common_gypi_fixes.patch
- 002: polyfills.patch
- 003: realm-vfs-binding.patch
- 004: node-gyp-vfs-binject.patch
- 005: node-binding-vfs.patch
- 006: node-sea-smol-config.patch
- 007: node-sea-header.patch
- 008: node-sea-bin-binject.patch
- 009: fix_v8_typeindex_macos.patch
- 010: vfs_bootstrap.patch
- 011: vfs_require_resolve.patch
- 012: debug-utils-smol-sea-category.patch
- 013: node-sea-silent-exit.patch
- 014: fast-webstreams.patch
- 016: http-perf-wire.patch
- 017: http-parser-pool.patch

**Invalid patch number:**

```
Error: Invalid patch number "999"
Valid patch numbers: 001-014, 016-017
```

## Success Criteria

- ✅ Skill `regenerating-node-patches` invoked successfully
- ✅ All requested patches regenerated from pristine source
- ✅ Each patch validated with `patch --dry-run`
- ✅ Patches persisted to `patches/source-patched/` directory
- ✅ No code differences detected (patches apply cleanly)
- ✅ Backup created (full mode only)
- ✅ `<promise>PATCH_REGEN_COMPLETE</promise>` emitted

## Completion Signal

Upon successful completion, the `regenerating-node-patches` skill emits:

```xml
<promise>PATCH_REGEN_COMPLETE</promise>
```

This signal indicates:

- All patches regenerated from pristine source
- Each patch validated with dry-run
- Patches persisted to patches directory
- Ready for build testing and commit

## Edge Cases

For comprehensive edge case handling, refer to the `regenerating-node-patches` skill documentation.

**Common issues:**

- **Patch fails to apply**: Context lines don't match pristine file (skill auto-retries with increased context)
- **Build fails after regeneration**: Review build log, check source files in additions/
- **Patch header malformed**: Skill uses `diff -u` (not git diff) to avoid this
- **Submodule not at correct SHA**: Full mode resets to SHA in .gitmodules

## Context

**Related Files:**

- Patches directory: `packages/node-smol-builder/patches/source-patched/`
- Patch list: `packages/node-smol-builder/patches/source-patched/` (001-014, 016-017)
- Node.js submodule: `packages/node-smol-builder/upstream/node/`
- Upstream version: Node.js v25.5.0

**Related Skills:**

- `regenerating-node-patches` - The skill invoked by this command

**Related Commands:**

- `/sync` - Update Node.js and regenerate patches
- `/sync-status` - Check current Node.js version
