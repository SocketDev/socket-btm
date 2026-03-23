---
name: regenerating-patches
description: Regenerates all Node.js patches from pristine upstream source. Triggers when patches fail to apply, after Node.js version update, or when restructuring patches. (project)
user-invocable: true
allowed-tools: Task
---

# regenerating-patches

<task>
Your task is to spawn an autonomous agent that regenerates Socket Security patches from pristine upstream source, ensuring each patch applies cleanly to unmodified upstream files with validation.
</task>

<context>
**What is Patch Regeneration?**
Socket Security maintains patches for two upstream projects:
1. **Node.js** - Patches applied during node-smol-builder builds
2. **iocraft** - Patches applied during iocraft-builder builds

These patches must be regenerated from pristine source when:
- Patches fail to apply to upstream source
- Upgrading to new upstream versions
- Refactoring patch structure for independence
- Ensuring patches apply cleanly to unmodified upstream files

**socket-btm Architecture:**
This is Socket Security's binary tooling manager (BTM) that:

- **Node.js patches**: `packages/node-smol-builder/patches/source-patched/*.patch`
  - Upstream: `packages/node-smol-builder/upstream/node` (submodule)
  - Patches Node.js source files (common.gypi, node.gyp, src/*, lib/*)

- **iocraft patches**: `packages/iocraft-builder/patches/*.patch`
  - Upstream: `packages/iocraft-builder/upstream/iocraft` (submodule)
  - Patches Rust source files (src/*.rs)

**Why Pristine Source Matters:**

- Each patch must apply to UNMODIFIED upstream files
- Ensures patches are independent and don't depend on previous patches
- Validates patch correctness against known-good baseline
- Prevents patch drift and cascading failures
</context>

<constraints>
**CRITICAL Safety Requirements:**
- Upstream submodule MUST be reset to pristine tagged version before each patch
- Patch MUST validate with `patch --dry-run -p1` before saving
- Workspace MUST be cleaned between patches (no state contamination)
- Use `diff -u a/file b/file` (NOT `git diff` or `git format-patch`) for standard unified format
- Do NOT create .backup-* files — git history serves as backup

**Mandatory Patch Header Format:**
ALL patches MUST use this consistent header format:

```
# @node-versions: vX.Y.Z
# @description: One-line summary of what the patch does
#
# Optional multi-line explanation
# of what the patch does and why.
#
--- a/target-file
+++ b/target-file
```

- First line: `# @node-versions: vX.Y.Z` (use current submodule tag)
- Second line: `# @description: ` followed by concise one-line summary
- Then `#` blank comment line
- Optional multi-line `#` comment explanation
- Then `#` blank comment line before the diff
- `--- a/file` and `+++ b/file` with NO timestamps
- For iocraft patches: use `# @iocraft-versions:` instead

**FORBIDDEN header format (old prose style):**
```
Socket Security: Description here    ← WRONG
                                     ← WRONG
This patch does something...         ← WRONG
```

**Do NOT:**
- Reuse modified upstream state between patches (breaks independence)
- Use `git diff` or `git format-patch` (produces wrong format)
- Skip validation with `patch --dry-run` (broken patches will fail builds)
- Preserve workspace state between patches (causes contamination)
- Omit `a/` and `b/` prefixes in diff headers (breaks patch application)
- Use the old "Socket Security:" prose header format
- Leave timestamps on `---`/`+++` lines

**Do ONLY:**
- Reset upstream submodule to pristine version before EACH patch
- Use `diff -u` or `diff -ruN` for patch generation (with a/ and b/ prefixes)
- Ensure patches have `--- a/` and `+++ b/` headers (NOT bare filenames)
- Use the standardized `# @node-versions` / `# @description` header format
- Validate every patch against pristine source with `patch --dry-run -p1`
- Clean workspace (`rm -rf /tmp/patch-rebuild`) after each patch
- Preserve ALL existing code modifications from current patches
</constraints>

<instructions>

## Process

This skill spawns an autonomous agent to handle the complete patch regeneration workflow.

### Phase 0: Determine Target and Version

<action>
Detect the upstream version from the submodule (do NOT hardcode versions):
</action>

```bash
# For Node.js
cd packages/node-smol-builder/upstream/node
NODE_VERSION=$(git describe --tags --exact-match HEAD 2>/dev/null)
echo "Node.js upstream: $NODE_VERSION"
cd -

# For iocraft
cd packages/iocraft-builder/upstream/iocraft
IOCRAFT_VERSION=$(git describe --tags --exact-match HEAD 2>/dev/null)
echo "iocraft upstream: $IOCRAFT_VERSION"
cd -
```

**Options:**
1. **node-smol** - Regenerate all Node.js patches
2. **iocraft** - Regenerate all iocraft patches
3. **both** - Regenerate both

### Phase 1: Validate Environment

<action>
Check that the upstream submodule(s) exist and list all patches:
</action>

```bash
# List all Node.js patches
ls packages/node-smol-builder/patches/source-patched/*.patch

# Verify submodule
cd packages/node-smol-builder/upstream/node && git describe --tags && cd -
```

<validation>
- ✓ Submodule exists and is at a tagged version
- ✓ Patch files exist
- ✓ Do NOT proceed if submodule is missing or broken
</validation>

---

### Phase 2: Spawn Autonomous Agent

<action>
Spawn a general-purpose agent with the patch regeneration instructions.

The agent prompt MUST include:
1. The detected upstream version (from Phase 0)
2. The full list of patches (from Phase 1)
3. The workflow below
</action>

**Agent workflow for EACH patch:**

1. **Read the current patch** to understand target file(s) and modifications.

2. **Reset upstream to pristine tagged version:**
   ```bash
   cd packages/node-smol-builder/upstream/node
   git checkout $NODE_VERSION -- .
   git clean -fd
   cd -
   ```

3. **Test if current patch applies cleanly:**
   ```bash
   cd packages/node-smol-builder/upstream/node
   patch --dry-run -p1 < ../../patches/source-patched/PATCH_NAME
   cd -
   ```

   **If patch applies cleanly:** Only standardize the header (update `@node-versions`, convert any old prose headers to `# @description` format). Write the updated patch.

   **If patch does NOT apply cleanly:** Regenerate the diff:
   a. Create workspace: `mkdir -p /tmp/patch-rebuild/a /tmp/patch-rebuild/b`
   b. Copy pristine files to both a/ and b/
   c. Apply ALL modifications from current patch to b/ files using Edit tool
   d. Generate diff: `cd /tmp/patch-rebuild && diff -ruN a/ b/ > new.diff || true`
   e. Strip timestamps from `---`/`+++` lines
   f. Prepend standardized header
   g. Validate: `patch --dry-run -p1 < new.patch`
   h. Write to patches directory
   i. Clean up: `rm -rf /tmp/patch-rebuild`

4. **Standardize header** — every patch MUST have:
   ```
   # @node-versions: $NODE_VERSION
   # @description: Concise summary
   #
   # Optional detail preserved from existing patch
   #
   ```
   Convert any old "Socket Security:" prose format to this standard format.
   Preserve the descriptive content, just restructure the format.

**Critical rules for the agent:**
- PRESERVE ALL existing code modifications — never simplify or remove changes
- Each patch MUST apply independently to pristine upstream
- Use `diff -ruN` for multi-file patches, `diff -u` for single-file
- Validate EVERY patch with `patch --dry-run -p1`
- Remove timestamps from `---`/`+++` lines
- Remove any existing `.backup-*` files in the patches directory
- Do NOT create new backup files

**Agent reporting:** One line per patch:
- `PATCH_NAME: ✓ applies cleanly (header standardized)`
- `PATCH_NAME: ✓ regenerated (context updated)`
- `PATCH_NAME: ✗ FAILED (reason)`

<validation>
After agent completion, verify:
- All patches reported as successful
- No `.backup-*` files left behind
- All patches have standardized `# @node-versions` / `# @description` headers
</validation>

---

### Phase 3: Complete

<summary>
Report final results to the user:

- Total patches processed
- Success/failure count
- Version used for regeneration
- Next steps: commit changes, run build to test
</summary>

</instructions>

## Success Criteria

- ✅ All patches regenerated/validated against pristine upstream
- ✅ Each patch validated with `patch --dry-run -p1`
- ✅ ALL patches use standardized `# @node-versions` / `# @description` header format
- ✅ No old "Socket Security:" prose headers remain
- ✅ No timestamps on `---`/`+++` lines
- ✅ Workspace cleaned between patches
- ✅ Ready for build testing

## Context

This skill is useful for:

- Regenerating patches when they fail to apply to upstream
- Updating patches after Node.js or iocraft version upgrades
- Ensuring patch independence (each applies to pristine source)
- Standardizing patch header format
- Validating patch correctness with `patch --dry-run`

**Safety:** Git history serves as backup. Rollback with `git checkout -- patches/`.

**Trade-offs:**

- ✓ Ensures patches apply to pristine source (no dependencies)
- ✓ Standard diff format (compatible with patch command)
- ✓ Consistent header format across all patches
- ✗ Requires understanding of patch intent when regenerating
