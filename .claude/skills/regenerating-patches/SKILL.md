---
name: regenerating-patches
description: Regenerates Node.js and iocraft patches from pristine upstream source, ensuring each applies independently. Use when patches fail to apply, after version updates, or when restructuring patches.
user-invocable: true
allowed-tools: Task
---

# regenerating-patches

Spawn an autonomous agent that regenerates Socket Security patches from pristine upstream source, ensuring each patch applies cleanly to unmodified upstream files.

## Patch Locations

- **Node.js**: `packages/node-smol-builder/patches/source-patched/*.patch`
- **iocraft**: `packages/iocraft-builder/patches/*.patch`

## Patch Header Format

All patches use this header:

```
# @node-versions: vX.Y.Z
# @description: One-line summary
#
# Optional detail
#
--- a/target-file
+++ b/target-file
```

For iocraft: use `# @iocraft-versions:` instead. No timestamps on `---`/`+++` lines.

## Process

### Phase 0: Determine Target and Version

Detect upstream version from the submodule tag (do not hardcode). Scope: node, iocraft, or both.

### Phase 1: Validate Environment

Verify submodule exists at a tagged version and list all patches.

### Phase 2: Spawn Agent

Spawn a general-purpose Task agent with the full patch list and upstream version. The agent processes each patch:

1. **Read current patch** to understand target files and modifications
2. **Reset upstream to pristine tag**: `git checkout $VERSION -- . && git clean -fd`
3. **Test if patch applies**: `patch --dry-run -p1 < PATCH_FILE`
   - If clean: standardize header only
   - If not: regenerate via workspace diff:
     - Copy pristine to `/tmp/patch-rebuild/a/` and `/tmp/patch-rebuild/b/`
     - Apply modifications to `b/` using Edit tool
     - Generate: `diff -ruN a/ b/`
     - Strip timestamps, prepend header, validate with `patch --dry-run -p1`
4. **Clean workspace** between patches

Key rules for the agent:
- Preserve all existing code modifications
- Each patch applies independently to pristine upstream
- Use `diff -ruN` (not `git diff` or `git format-patch`)
- Validate every patch with `patch --dry-run -p1`
- Remove any `.backup-*` files; do not create new ones

### Phase 3: Report

Report per-patch status, total processed, success/failure count, and version used.

See `reference.md` for the complete agent prompt template and detailed workflow.
