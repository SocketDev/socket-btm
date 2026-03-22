---
name: regenerating-node-patches
description: Regenerates all 16 Node.js patches from pristine upstream source. Triggers when patches fail to apply, after Node.js version update, or when restructuring patches.
user-invocable: true
allowed-tools: Task
---

# regenerating-node-patches

<task>
Your task is to spawn an autonomous agent that regenerates all Socket Security Node.js patches from pristine upstream Node.js v25.5.0 source, ensuring each patch applies cleanly to unmodified upstream files with proper backups and validation.
</task>

<context>
**What is Patch Regeneration?**
Socket Security maintains 16 security and functionality patches that are applied to upstream Node.js source during the build process. These patches must be regenerated from pristine source when:
- Patches fail to apply to upstream Node.js
- Upgrading to new Node.js versions
- Refactoring patch structure for independence
- Ensuring patches apply cleanly to unmodified upstream files

**socket-btm Architecture:**
This is Socket Security's binary tooling manager (BTM) that:

- Builds custom Node.js binaries with Socket Security patches
- Maintains patches in `packages/node-smol-builder/patches/source-patched/`
- Uses upstream Node.js submodule at `packages/node-smol-builder/upstream/node`
- Applies 16 patches to Node.js source files (common.gypi, node.gyp, src/_, lib/_)
- Produces production-ready patched Node.js binaries

**Patch Types:**

1. **Build System Patches** - common.gypi, node.gyp modifications
2. **VFS (Virtual File System) Patches** - Custom file system integration
3. **SEA (Single Executable Application) Patches** - Embedded binary support
4. **Polyfill Patches** - Runtime environment fixes

**Why Pristine Source Matters:**

- Each patch must apply to UNMODIFIED upstream files
- Ensures patches are independent and don't depend on previous patches
- Validates patch correctness against known-good baseline (v25.5.0)
- Prevents patch drift and cascading failures
  </context>

<constraints>
**CRITICAL Safety Requirements:**
- Original patch MUST be backed up with timestamp before any changes
- Upstream Node.js submodule MUST be reset to pristine v25.5.0 before each patch
- Patch MUST validate with `patch --dry-run` before saving
- Workspace MUST be cleaned between patches (no state contamination)
- Use `diff -u` (NOT `git diff`) for standard unified format

**Do NOT:**

- Skip backup creation (NEVER - data loss risk)
- Reuse modified upstream state between patches (NEVER - breaks independence)
- Use `git diff` instead of `diff` (incompatible format for patch command)
- Skip validation with `patch --dry-run` (NEVER - broken patches will fail builds)
- Preserve workspace state between patches (NEVER - causes contamination)

**Do ONLY:**

- Create timestamped backups before overwriting patches
- Reset upstream/node to pristine v25.5.0 before EACH patch
- Use `diff -u pristine modified` for patch generation
- Validate every patch against pristine source
- Clean workspace (`rm -rf /tmp/patch-rebuild`) after each patch
- Preserve original Socket Security patch headers
  </constraints>

<instructions>

## Process

This skill spawns an autonomous agent to handle the complete patch regeneration workflow. The agent will process all 16 patches sequentially.

### Phase 1: Validate Environment

<prerequisites>
Before spawning the agent, verify the environment is ready:
</prerequisites>

<action>
Check that the upstream Node.js submodule exists and is at the correct version:
</action>

```bash
# Verify upstream submodule exists
ls -la packages/node-smol-builder/upstream/node

# Check current Node.js version in submodule
cd packages/node-smol-builder/upstream/node && git describe --tags
```

<validation>
**Expected State:**
- ✓ Submodule directory exists: `packages/node-smol-builder/upstream/node/`
- ✓ Git repository is valid (not empty)
- ✓ Tagged with v25.5.0 or can be reset to v25.5.0

**If submodule is missing or broken:**

- Initialize: `git submodule update --init --recursive`
- Or report error and ask user to fix submodule

Do NOT proceed if upstream/node submodule is not accessible.
</validation>

---

### Phase 2: Spawn Autonomous Agent

<action>
Spawn a general-purpose agent with detailed instructions for regenerating all patches:
</action>

**Use Task tool with the following prompt:**

````javascript
Task({
  subagent_type: "general-purpose",
  description: "Regenerate Node.js patches from pristine source",
  prompt: `Regenerate Socket Security Node.js patches from pristine upstream Node.js v25.5.0 source.

<task>
Your task is to regenerate 16 Socket Security Node.js patches from pristine upstream Node.js v25.5.0 source, ensuring each patch applies cleanly to unmodified upstream files. You must follow the 8-step workflow for EACH patch with proper backups, validation, and cleanup.
</task>

<context>
**Project Context:**
You are working on socket-btm (Socket Security's binary tooling manager) which builds custom Node.js binaries with security patches. The patches are stored in:
- Original patches: packages/node-smol-builder/patches/source-patched/
- Upstream Node.js: packages/node-smol-builder/upstream/node (submodule at v25.5.0)

**Why Regenerate Patches:**
- Ensures patches apply to pristine upstream (no dependencies between patches)
- Uses standard diff format (not git diff) for portability
- Validates correctness with patch --dry-run
- Creates backups to prevent data loss

**Patch Inventory (16 total):**
1. 001-common_gypi_fixes.patch → common.gypi
2. 002-polyfills.patch → lib/internal/bootstrap/realm.js
3. 003-realm-vfs-binding.patch → lib/internal/bootstrap/realm.js
4. 004-node-gyp-vfs-binject.patch → node.gyp
5. 005-node-binding-vfs.patch → src/node_binding.cc
6. 006-node-sea-smol-config.patch → src/node_sea.cc
7. 007-node-sea-header.patch → src/node_sea.h
8. 008-node-sea-bin-binject.patch → src/node_sea.cc
9. 009-fix_v8_typeindex_macos.patch → deps/v8/src/wasm/value-type.h
10. 010-vfs_bootstrap.patch → lib/internal/process/pre_execution.js
11. 011-vfs_require_resolve.patch → lib/internal/modules/cjs/loader.js
12. 012-debug-utils-smol-sea-category.patch → lib/internal/util/debuglog.js
13. 013-node-sea-silent-exit.patch → src/node_main.cc
14. 014-fast-webstreams.patch → lib/internal/bootstrap/node.js
15. 016-http-perf-wire.patch → lib/internal/bootstrap/node.js
16. 017-http-parser-pool.patch → lib/_http_common.js
</context>

<constraints>
**CRITICAL Requirements (MUST follow for EACH patch):**
- ALWAYS backup original patch with timestamp BEFORE any changes
- ALWAYS reset upstream/node to pristine v25.5.0 BEFORE working on each patch
- ALWAYS use diff -u (NOT git diff) for standard unified format
- ALWAYS validate with patch --dry-run before saving
- ALWAYS clean workspace between patches (no state reuse)
- ALWAYS preserve Socket Security headers from original patch
- **🚨 CRITICAL: ALWAYS preserve ALL existing modifications (comments, custom logic, warnings) from current patch**
- **🚨 NEVER recreate patches from scratch - ONLY fix format issues**

**Failure Modes to Prevent:**
- **DATA LOSS: Discarding intentional modifications from current patches (MOST CRITICAL)**
- Patch contamination (using modified upstream for next patch)
- Missing backups (can't rollback if regeneration fails)
- Invalid patches (skipping validation causes build failures)
- Format incompatibility (git diff format doesn't work with patch command)
</constraints>

<instructions>

## Critical Workflow (MUST FOLLOW FOR EACH PATCH)

For EACH of the 16 patches, execute these 8 steps:

### Step 1: Backup Original Patch

<action>
Create timestamped backup of the original patch before any modifications:
</action>

\`\`\`bash
PATCH_NAME="001-common_gypi_fixes.patch"  # Example - use actual patch name
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
cp packages/node-smol-builder/patches/source-patched/$PATCH_NAME \\
   packages/node-smol-builder/patches/source-patched/$PATCH_NAME.backup-$TIMESTAMP
\`\`\`

<validation>
Verify backup created:
\`\`\`bash
ls -lh packages/node-smol-builder/patches/source-patched/$PATCH_NAME.backup-*
\`\`\`

Expected: Backup file exists with timestamp in filename.
</validation>

---

### Step 2: Reset Upstream Node.js Submodule to Pristine State

<action>
CRITICAL: Reset upstream Node.js to pristine v25.5.0 - no modifications from previous patches:
</action>

\`\`\`bash
cd packages/node-smol-builder/upstream/node
git reset --hard v25.5.0
git clean -fd
cd -
\`\`\`

<validation>
Verify pristine state:
\`\`\`bash
cd packages/node-smol-builder/upstream/node
git status  # Should show "nothing to commit, working tree clean"
git describe --tags  # Should show v25.5.0
cd -
\`\`\`

Expected: Working tree clean, no uncommitted changes, tagged v25.5.0.
</validation>

---

### Step 3: Get Pristine Target File

<action>
Identify which file this patch modifies and copy pristine version to workspace:
</action>

\`\`\`bash
# Read original patch to identify target file (look at --- a/FILE or +++ b/FILE lines)
# For example: 001-common_gypi_fixes.patch modifies common.gypi

TARGET_FILE="common.gypi"  # Example - extract from patch

# Create clean workspace
mkdir -p /tmp/patch-rebuild
cd packages/node-smol-builder/upstream/node

# Copy pristine file to workspace
cp $TARGET_FILE /tmp/patch-rebuild/pristine-$TARGET_FILE
cd -
\`\`\`

<validation>
Verify pristine file copied:
\`\`\`bash
ls -lh /tmp/patch-rebuild/pristine-*
\`\`\`

Expected: Pristine file exists in workspace.
</validation>

---

### Step 4: Modify the Specific File

**🚨 CRITICAL: PRESERVE ALL EXISTING MODIFICATIONS 🚨**

The goal of patch regeneration is to **FIX FORMAT ISSUES**, NOT to discard work:
- ✅ PRESERVE all intentional Socket Security modifications from the current patch
- ✅ PRESERVE all added comments, warnings, and custom logic
- ✅ ONLY fix format issues (line numbers, context lines, diff format)
- ❌ NEVER recreate patches from scratch
- ❌ NEVER remove modifications that were intentionally added
- ❌ NEVER simplify or change the logic

<action>
Read original patch to understand Socket Security changes, then apply ALL modifications:
</action>

\`\`\`bash
# Copy pristine to modified
cp /tmp/patch-rebuild/pristine-$TARGET_FILE /tmp/patch-rebuild/modified-$TARGET_FILE

# Read CURRENT patch (not just headers - read EVERYTHING)
# This patch may have recent modifications that MUST be preserved
cat packages/node-smol-builder/patches/source-patched/$PATCH_NAME

# MANUAL STEP: Apply Socket Security modifications to modified-$TARGET_FILE
# Use Edit tool (manual invocation by skill executor, not agent-automated)
# CRITICAL: Apply ALL changes from the current patch
# If you see custom comments, warnings, or modified logic - PRESERVE THEM
#
# Decision tree for each modification:
# 1. Is this a format issue (wrong line numbers, missing context)?
#    → This is what you're fixing
# 2. Is this an intentional modification (custom logic, Socket Security additions)?
#    → PRESERVE this exactly as-is
# 3. Is this a comment explaining Socket Security changes?
#    → PRESERVE this exactly as-is
#
# NEVER simplify, remove, or change intentional modifications
\`\`\`

<validation>
Think through these validation questions:
1. Did you read the ENTIRE current patch (not just headers)?
2. Did you identify ALL modifications (including comments and custom logic)?
3. Did you PRESERVE all intentional modifications from the current patch?
4. Did you apply ALL changes without removing or simplifying anything?
5. Did you verify the modifications match the current patch exactly?

Compare your changes:
\`\`\`bash
diff -u /tmp/patch-rebuild/pristine-$TARGET_FILE /tmp/patch-rebuild/modified-$TARGET_FILE
\`\`\`

Expected: Diff shows the Socket Security changes you applied.
</validation>

---

### Step 5: Create Patch (diff style, NOT git diff)

<action>
Generate patch in standard unified diff format:
</action>

\`\`\`bash
cd /tmp/patch-rebuild

# Generate diff with unified format (minimum 3 context lines)
diff -u pristine-$TARGET_FILE modified-$TARGET_FILE > raw-patch.diff

# Read Socket Security header from original patch (lines starting with #)
# Preserve these comments - they document what the patch does

# Create final patch with header
cat > final-patch.patch << 'EOF'
# Socket Security: [Copy brief description from original]
# [Copy detailed explanation from original]
# Files modified: $TARGET_FILE
EOF

# Append the diff
cat raw-patch.diff >> final-patch.patch

# Normalize headers to standard format (remove temp workspace filenames)
sed -i.bak "s|^--- pristine-|--- a/|; s|^+++ modified-|+++ b/|" final-patch.patch
rm final-patch.patch.bak

# CRITICAL: Remove timestamps from diff headers (Windows patch tool compatibility)
# Format: --- a/file.txt	2026-02-09 07:29:17  →  --- a/file.txt
sed -i.bak "s|^\(---[[:space:]]a/[^[:space:]]*\)[[:space:]].*|\1|; s|^\(+++[[:space:]]b/[^[:space:]]*\)[[:space:]].*|\1|" final-patch.patch
rm final-patch.patch.bak
\`\`\`

<validation>
Verify patch format:
\`\`\`bash
head -20 /tmp/patch-rebuild/final-patch.patch
\`\`\`

Expected:
- Socket Security comments at top (lines starting with #)
- Standard diff headers: --- a/FILE and +++ b/FILE (with a/ and b/ prefixes, NO timestamps)
- Unified diff hunks with @@ markers
- Context lines (unchanged) and change lines (+/-)

**CRITICAL Format Requirements:**
- ✅ MUST have \`a/\` and \`b/\` prefixes: \`--- a/node.gyp\` and \`+++ b/node.gyp\`
- ✅ MUST NOT have timestamps after filename (Windows patch tool compatibility)
- ❌ WRONG: \`--- a/node.gyp	2026-02-09 07:29:17\`
- ✅ CORRECT: \`--- a/node.gyp\`
</validation>

---

### Step 6: Validate Patch Against Pristine

<action>
CRITICAL: Validate patch applies cleanly to pristine source (dry-run, no actual changes):
</action>

\`\`\`bash
cd /tmp/patch-rebuild

# Copy pristine for testing
cp pristine-$TARGET_FILE test-$TARGET_FILE

# Test patch application (dry-run)
if ! patch --dry-run test-$TARGET_FILE < final-patch.patch; then
  echo "ERROR: Patch validation failed!"
  echo "Patch contents:"
  cat final-patch.patch
  echo ""
  echo "This patch does NOT apply cleanly to pristine $TARGET_FILE"
  exit 1
fi

# Clean up test file
rm test-$TARGET_FILE
\`\`\`

<validation>
Think through these validation questions:
1. Did patch --dry-run succeed (exit 0)?
2. Are there any "FAILED" or "reject" messages?
3. Does the patch apply to pristine source without errors?

**If validation fails:**
- Review your modifications in Step 4
- Compare with original patch to see what you missed
- Regenerate the diff and retry validation
- Do NOT proceed to Step 7 if validation fails

Expected: patch --dry-run exits 0 with no errors.
</validation>

---

### Step 6.5: Semantic Validation (CRITICAL - Prevent Data Loss)

<action>
CRITICAL: Verify new patch preserves all intentional Socket Security modifications from original patch:
</action>

```bash
cd /tmp/patch-rebuild

echo "=== Semantic Validation ==="
echo "Comparing Socket Security modifications..."

# Extract additions from original patch (lines starting with + but not ++)
ORIGINAL_ADDS=$(grep '^+[^+]' "$PATCH_FILE.backup" | sort)
NEW_ADDS=$(grep '^+[^+]' final-patch.patch | sort)

# Count modifications
ORIGINAL_COUNT=$(echo "$ORIGINAL_ADDS" | wc -l | tr -d ' ')
NEW_COUNT=$(echo "$NEW_ADDS" | wc -l | tr -d ' ')

echo "Original patch: $ORIGINAL_COUNT additions"
echo "New patch: $NEW_COUNT additions"

# CRITICAL CHECK: Detect data loss
if [ "$NEW_COUNT" -lt "$ORIGINAL_COUNT" ]; then
  echo ""
  echo "❌ CRITICAL ERROR: Data loss detected!"
  echo "New patch has FEWER modifications than original"
  echo "Some Socket Security modifications are missing!"
  echo ""
  echo "Diff of additions:"
  diff <(echo "$ORIGINAL_ADDS") <(echo "$NEW_ADDS") || true
  echo ""
  echo "DO NOT PROCEED - Review Step 4 modifications"
  exit 1
fi

# WARNING CHECK: Detect changes to modifications
if [ "$ORIGINAL_ADDS" != "$NEW_ADDS" ]; then
  echo ""
  echo "⚠️  WARNING: Modifications changed between patches"
  echo "This may be intentional (fixing format) or unintentional (data loss)"
  echo ""
  echo "Showing diff of additions:"
  diff <(echo "$ORIGINAL_ADDS") <(echo "$NEW_ADDS") || true
  echo ""
  echo "Review carefully:"
  echo "- Format fixes (line numbers, context) = OK"
  echo "- Changed logic or removed code = NOT OK"
  echo ""
  read -p "Continue? (y/N) " -n 1 -r
  echo ""
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Aborted - review modifications in Step 4"
    exit 1
  fi
fi

echo "✅ Semantic validation passed"
echo "All Socket Security modifications preserved"
````

<validation>
**This step prevents DATA LOSS by ensuring:**
1. All Socket Security modifications from original patch are present
2. No intentional code additions were accidentally removed
3. Changes are reviewed if modifications differ

**Why This Matters:**

- Original patches contain intentional Socket Security enhancements
- Format fixes (line numbers, context) are expected and safe
- Logic changes or removed code indicate errors in Step 4
- Without this check, subtle data loss could go undetected

**If validation fails:**

- Review Step 4 modifications carefully
- Compare original patch to understand what was lost
- Regenerate modifications preserving all intentional changes
- Do NOT proceed to Step 7 if critical error detected

**If warning appears:**

- Review diff carefully to understand changes
- Confirm changes are format-only (line numbers, whitespace)
- Reject if any logic or intentional code was modified

Expected: All additions from original patch present in new patch (or explicitly reviewed if different).
</validation>

---

### Step 7: Save Patch

<action>
Copy validated patch to patches directory, replacing original:
</action>

\`\`\`bash
cp /tmp/patch-rebuild/final-patch.patch \\
packages/node-smol-builder/patches/source-patched/$PATCH_NAME
\`\`\`

<validation>
Verify patch saved and compare sizes:
\`\`\`bash
ls -lh packages/node-smol-builder/patches/source-patched/$PATCH_NAME
ls -lh packages/node-smol-builder/patches/source-patched/$PATCH_NAME.backup-*
\`\`\`

Expected:

- New patch exists
- File size similar to backup (within 10-20%)
- Backup still exists (rollback available)
  </validation>

---

### Step 8: Reset Upstream Node Submodule (Cleanup)

<action>
CRITICAL: Reset upstream to pristine state for next patch and clean workspace:
</action>

\`\`\`bash
cd packages/node-smol-builder/upstream/node
git reset --hard v25.5.0
git clean -fd
cd -

# Clean workspace

rm -rf /tmp/patch-rebuild
\`\`\`

<validation>
Verify clean state:
\`\`\`bash
cd packages/node-smol-builder/upstream/node
git status  # Should be clean
cd -
ls /tmp/patch-rebuild  # Should not exist
\`\`\`

Expected:

- Upstream Node.js pristine (no modifications)
- Workspace removed (no state leakage to next patch)

This ensures the next patch starts from pristine v25.5.0.
</validation>

---

## Reporting

For each patch, report:

**Patch: [NAME]**

- Backup: [BACKUP_FILENAME]
- Target file: [FILE_PATH]
- Validation: ✓ Passed / ✗ Failed
- Original size: [SIZE]
- New size: [SIZE]
- Status: ✓ Complete

At the end, provide summary:

# **Patch Regeneration Complete**

Total patches: 16
Successful: [N]
Failed: [N]
Backups created: [N]

All patches validated with patch --dry-run against pristine v25.5.0.
</instructions>

<completion_signal>
\`\`\`xml
<promise>PATCH_REGENERATION_COMPLETE</promise>
\`\`\`
</completion_signal>

<success_criteria>

- ✅ All 16 patches regenerated from pristine v25.5.0
- ✅ Each patch backed up with timestamp before replacement
- ✅ Each patch validated with patch --dry-run (100% success rate)
- ✅ Workspace cleaned between patches (no contamination)
- ✅ Socket Security headers preserved in all patches
- ✅ Ready for build testing
  </success_criteria>
  `
  })

````

<validation>
**After agent completion, verify:**
- Agent output shows `<promise>PATCH_REGENERATION_COMPLETE</promise>`
- All 16 patches reported as successful
- Backup files exist for all patches (*.backup-TIMESTAMP)
- No errors in validation steps

**Report to user:**
- Total patches regenerated: 16
- Success rate: [N]/16
- Backup location: packages/node-smol-builder/patches/source-patched/*.backup-*
- Next steps: Run build to test patches
</validation>

---

### Phase 3: Complete

<completion_signal>
```xml
<promise>SKILL_COMPLETE</promise>
````

</completion_signal>

<summary>
Report final results to the user:

# **Patch Regeneration Skill Complete**

✓ Autonomous agent spawned
✓ Agent completed patch regeneration workflow
✓ Total patches regenerated: 16
✓ All patches validated against pristine v25.5.0
✓ Original patches backed up with timestamps
✓ Ready for build testing

**Backup Location:**
packages/node-smol-builder/patches/source-patched/\*.backup-[TIMESTAMP]

**Next Steps:**

1. Test build with regenerated patches: `pnpm run build`
2. Verify patched Node.js works correctly
3. If issues found, rollback: `cp *.backup-[TIMESTAMP] [PATCH_NAME]`
4. Commit regenerated patches if build succeeds

All patches are now regenerated from pristine upstream v25.5.0 source.

</summary>

</instructions>

## Success Criteria

- ✅ `<promise>SKILL_COMPLETE</promise>` output
- ✅ Autonomous agent spawned with detailed instructions
- ✅ Agent completed patch regeneration workflow
- ✅ All 16 patches regenerated from pristine v25.5.0
- ✅ Original patches backed up before replacement
- ✅ Each patch validated with `patch --dry-run`
- ✅ Workspace cleaned between patches
- ✅ Ready for build testing

## Commands

This skill spawns an autonomous agent. No direct commands needed.

## Context

This skill is useful for:

- Regenerating patches when they fail to apply to upstream Node.js
- Updating to new Node.js versions (change v25.5.0 to new version)
- Ensuring patch independence (each applies to pristine source)
- Validating patch correctness with patch --dry-run
- Creating safety backups before patch modifications

**Safety:** All original patches backed up with timestamps. Rollback available if regeneration fails.

**Trade-offs:**

- ✓ Ensures patches apply to pristine source (no dependencies)
- ✓ Standard diff format (compatible with patch command)
- ✓ Validated against known-good baseline (v25.5.0)
- ✓ Safety backups created automatically
- ✗ Requires manual understanding of patch intent
- ✗ Time-consuming for all 16 patches
