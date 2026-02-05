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
  prompt: `Regenerate all Socket Security Node.js patches from pristine upstream Node.js v25.5.0 source.

## Requirements
1. Each patch applies to unmodified upstream Node.js v25.5.0
2. One patch = one file modification
3. Patches are independent (no dependencies)
4. Use 3+ context lines for stable application
5. Validate with dry-run before saving

## Patch Workflow

For each patch (001-013):

### 1. Obtain Pristine File
\`\`\`bash
cd /tmp/patch-rebuild
gh repo clone nodejs/node node-pristine
cd node-pristine && git checkout v25.5.0
cp path/to/target/file ../target-pristine.ext
cd .. && rm -rf node-pristine
\`\`\`

### 2. Read Current Patch
Understand which file it modifies and what changes are needed.

### 3. Apply Modifications
\`\`\`bash
cp target-pristine.ext target-modified.ext
# Edit target-modified.ext to apply changes
\`\`\`

### 4. Generate New Patch
\`\`\`bash
diff -u target-pristine.ext target-modified.ext > new-patch.patch

# Add Socket Security header
cat > final-patch.patch << 'EOF'
# Socket Security: [Brief description]
# [Detailed explanation]
# Files modified: path/to/file
EOF
cat new-patch.patch >> final-patch.patch

# Normalize headers
sed -i.bak 's|^--- target-pristine.ext|--- a/target-file.ext|; s|^+++ target-modified.ext|+++ b/target-file.ext|' final-patch.patch
rm final-patch.patch.bak
\`\`\`

### 5. Validate Patch
\`\`\`bash
for i in 1 2 3; do
  cp target-pristine.ext target-test.ext
  if patch --dry-run target-test.ext < final-patch.patch 2>&1 | tee /tmp/patch-validation.log; then
    rm target-test.ext && break
  fi
  if [ $i -eq 3 ]; then
    echo "Patch validation failed - check /tmp/patch-validation.log"
    exit 1
  fi
  # Try increasing context
  diff -U 5 target-pristine.ext target-modified.ext > final-patch.patch
  sleep 2
done
\`\`\`

### 6. Persist
\`\`\`bash
cp final-patch.patch packages/node-smol-builder/patches/source-patched/NNN-patch-name.patch
\`\`\`

## Patch List (13 Total)

1. 001-common_gypi_fixes.patch
2. 002-polyfills.patch
3. 003-fix_gyp_py3_hashlib.patch
4. 004-realm-vfs-binding.patch
5. 005-node-gyp-vfs-binject.patch
6. 006-node-binding-vfs.patch
7. 007-node-sea-smol-config-header.patch
8. 008-node-sea-smol-config.patch
9. 009-node-sea-header.patch
10. 010-node-sea-bin-binject.patch
11. 011-fix_v8_typeindex_macos.patch
12. 012-vfs_bootstrap.patch
13. 013-vfs_require_resolve.patch

## Setup
\`\`\`bash
# Backup patches
cp -r packages/node-smol-builder/patches/source-patched packages/node-smol-builder/patches/source-patched.backup-$(date +%Y%m%d-%H%M%S)

# Clean
pnpm --filter node-smol-builder run clean
rm -rf /tmp/patch-rebuild && mkdir -p /tmp/patch-rebuild
\`\`\`

## Validation
After regenerating all patches:
\`\`\`bash
cd packages/node-smol-builder
git status && git diff patches/source-patched/
pnpm run clean && pnpm run build
\`\`\`

Report: Number regenerated, validation status, build results`
})
```

## Success Criteria

- ✅ All requested patches regenerated from pristine v25.5.0
- ✅ Each patch validated with \`patch --dry-run\`
- ✅ Patches persisted to \`patches/source-patched/\`
- ✅ Ready for build testing
