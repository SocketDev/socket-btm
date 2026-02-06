---
name: regenerating-node-patches
description: Regenerates Node.js patches from pristine upstream source to ensure each patch applies cleanly to unmodified upstream files. Use when Node.js patches fail to apply, when updating to new Node.js versions, or when refactoring patch structure for independence.
user-invocable: true
disable-model-invocation: false
allowed-tools: Task
---

# regenerating-node-patches

## Role

Node.js Patch Regeneration Specialist that spawns an autonomous agent to regenerate all Socket Security Node.js patches from pristine upstream source.

## Action

When invoked, spawn a general-purpose agent using the Task tool to handle the complete patch regeneration workflow autonomously.

## Instructions

```javascript
Task({
  subagent_type: "general-purpose",
  description: "Regenerate Node.js patches from pristine source",
  prompt: `Regenerate Socket Security Node.js patches from pristine upstream Node.js v25.5.0 source.

## Critical Workflow (MUST FOLLOW FOR EACH PATCH)

For EACH patch being regenerated:

### Step 1: Backup Original Patch
\`\`\`bash
PATCH_NAME="005-node-gyp-vfs-binject.patch"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
cp packages/node-smol-builder/patches/source-patched/$PATCH_NAME \
   packages/node-smol-builder/patches/source-patched/$PATCH_NAME.backup-$TIMESTAMP
\`\`\`

### Step 2: Reset/Get Pristine Node.js Upstream
\`\`\`bash
# Clean workspace
rm -rf /tmp/patch-rebuild
mkdir -p /tmp/patch-rebuild
cd /tmp/patch-rebuild

# Clone pristine Node.js v25.5.0
gh repo clone nodejs/node upstream-node
cd upstream-node
git checkout v25.5.0
\`\`\`

### Step 3: Get Pristine Target File
\`\`\`bash
# Identify which file this patch modifies (e.g., node.gyp)
TARGET_FILE="node.gyp"

# Copy pristine file out
cp $TARGET_FILE /tmp/patch-rebuild/pristine-$TARGET_FILE
\`\`\`

### Step 4: Modify the Specific File
\`\`\`bash
# Copy pristine to modified
cp /tmp/patch-rebuild/pristine-$TARGET_FILE /tmp/patch-rebuild/modified-$TARGET_FILE

# Read the additions file to understand what changes to apply
# Read: packages/node-smol-builder/additions/source-patched/$TARGET_FILE

# Apply the Socket Security modifications to modified-$TARGET_FILE
# Use Edit tool to make the changes
\`\`\`

### Step 5: Create Patch (diff style, NOT git diff)
\`\`\`bash
cd /tmp/patch-rebuild

# Generate diff with unified format (3+ context lines)
diff -u pristine-$TARGET_FILE modified-$TARGET_FILE > raw-patch.diff

# Add Socket Security header (read from original patch file)
cat > final-patch.patch << 'EOF'
# Socket Security: [Brief description from original]
# [Detailed explanation from original]
# Files modified: $TARGET_FILE
EOF

# Append the diff
cat raw-patch.diff >> final-patch.patch

# Normalize headers to standard format
sed -i.bak "s|^--- pristine-|--- a/|; s|^+++ modified-|+++ b/|" final-patch.patch
rm final-patch.patch.bak
\`\`\`

### Step 6: Validate Patch
\`\`\`bash
# Validate against pristine source
cp pristine-$TARGET_FILE test-$TARGET_FILE
if ! patch --dry-run test-$TARGET_FILE < final-patch.patch; then
  echo "ERROR: Patch validation failed!"
  cat final-patch.patch
  exit 1
fi
rm test-$TARGET_FILE
\`\`\`

### Step 7: Save Patch
\`\`\`bash
cp final-patch.patch /Users/jdalton/projects/socket-btm/packages/node-smol-builder/patches/source-patched/$PATCH_NAME
\`\`\`

### Step 8: Reset Upstream Node (Cleanup)
\`\`\`bash
cd /tmp
rm -rf /tmp/patch-rebuild
\`\`\`

## Patches to Regenerate (13 Total)

1. 001-common_gypi_fixes.patch - modifies: common.gypi
2. 002-polyfills.patch - modifies: lib/internal/bootstrap/realm.js
3. 003-fix_gyp_py3_hashlib.patch - modifies: tools/gyp/pylib/gyp/common.py
4. 004-realm-vfs-binding.patch - modifies: lib/internal/bootstrap/realm.js
5. 005-node-gyp-vfs-binject.patch - modifies: node.gyp
6. 006-node-binding-vfs.patch - modifies: src/node_binding.cc
7. 007-node-sea-smol-config-header.patch - modifies: src/node_sea.h
8. 008-node-sea-smol-config.patch - modifies: src/node_sea.cc
9. 009-node-sea-header.patch - modifies: src/node_sea.h
10. 010-node-sea-bin-binject.patch - modifies: src/node_sea.cc
11. 011-fix_v8_typeindex_macos.patch - modifies: common.gypi
12. 012-vfs_bootstrap.patch - modifies: lib/internal/bootstrap/node.js
13. 013-vfs_require_resolve.patch - modifies: lib/internal/modules/cjs/loader.js

## Important Notes

- **ALWAYS backup before overwriting**
- **ALWAYS reset upstream node between patches** (clean state)
- **Use diff, NOT git diff** (standard unified format)
- **Read additions file** to understand Socket Security changes
- **Preserve original patch headers** (Socket Security comments)
- **Validate with patch --dry-run** before saving
- **Use minimum 3 lines of context** (diff -u or diff -U 3)

## Success Criteria

- ✅ Original patch backed up with timestamp
- ✅ Pristine Node.js v25.5.0 used as base
- ✅ Modifications applied correctly to target file
- ✅ Patch generated with diff (not git diff)
- ✅ Patch validates with \`patch --dry-run\`
- ✅ Workspace cleaned up after each patch
- ✅ New patch saved to patches/source-patched/

Report for each patch: Backup location, validation status, file size comparison`
})
```

## Success Criteria

- ✅ All requested patches regenerated from pristine v25.5.0
- ✅ Original patches backed up before replacement
- ✅ Each patch validated with `patch --dry-run`
- ✅ Workspace cleaned between patches
- ✅ Ready for build testing
