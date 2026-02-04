---
name: regenerating-node-patches
description: Regenerates Node.js patches from pristine upstream source to ensure each patch applies cleanly to unmodified upstream files. Use when Node.js patches fail to apply, when updating to new Node.js versions, or when refactoring patch structure for independence.
user-invocable: true
disable-model-invocation: true
allowed-tools: Read, Write, Bash, Grep, Glob
---

# regenerating-node-patches

## Purpose

This skill regenerates all Socket Security Node.js patches from pristine upstream source to ensure:
- Each patch modifies only a single file from pristine Node.js source
- No assumptions about prior patches being applied
- Clean application with correct context lines
- Validation via dry-run before persisting

## Critical Requirements

1. **Pristine Source**: Each patch must apply to unmodified upstream Node.js v25.5.0
2. **Single File**: One patch = one file modification
3. **No Dependencies**: Patches apply independently, sequenced only for build order
4. **Context Lines**: Sufficient context (3 lines) for stable patch application
5. **Validation**: Dry-run test before saving

## Patch Workflow

For each patch in sequence (001-013):

### Step 1: Obtain Pristine File

```bash
# Get pristine version of target file from upstream
cd /tmp/patch-rebuild
gh repo clone nodejs/node node-pristine
cd node-pristine
git checkout v25.5.0
cp path/to/target/file ../target-pristine.ext
cd ..
rm -rf node-pristine
```

### Step 2: Read Current Patch

Read the existing patch to understand:
- Which file it modifies
- What changes are needed
- Intended functionality

### Step 3: Apply Modifications

```bash
# Copy pristine to working version
cp target-pristine.ext target-modified.ext

# Apply modifications (manually edit or script)
# For example, using sed, awk, or direct editing
```

### Step 4: Generate New Patch

```bash
# Create unified diff (NOT git diff - no git metadata)
diff -u target-pristine.ext target-modified.ext > new-patch.patch

# Add header comment block explaining the patch
cat > final-patch.patch << 'EOF'
# Socket Security: [Brief description]
#
# [Detailed explanation of changes]
#
# Files modified:
# - path/to/file: [What changed]
#
EOF

# Append the diff
cat new-patch.patch >> final-patch.patch

# Normalize headers to a/b format for consistency
# diff -u uses raw filenames, but we want standardized a/ and b/ prefixes
sed -i.bak 's|^--- target-pristine.ext|--- a/target-file.ext|; s|^+++ target-modified.ext|+++ b/target-file.ext|' final-patch.patch
rm final-patch.patch.bak
```

### Step 5: Validate Patch (with Ralph Loop)

```bash
# Ralph loop for patch validation with auto-retry
ITERATION=1
MAX_ITERATIONS=3

while [ $ITERATION -le $MAX_ITERATIONS ]; do
  echo "Patch validation attempt $ITERATION/$MAX_ITERATIONS"

  # Test on fresh pristine copy
  cp target-pristine.ext target-test.ext

  if patch --dry-run target-test.ext < final-patch.patch 2>&1 | tee /tmp/patch-validation.log; then
    echo "✓ Patch validates successfully"
    rm target-test.ext
    break
  fi

  echo "⚠ Patch validation failed (Iteration $ITERATION/$MAX_ITERATIONS)"

  if [ $ITERATION -eq $MAX_ITERATIONS ]; then
    echo "✗ Patch validation failed after $MAX_ITERATIONS attempts"
    echo ""
    echo "Manual intervention required:"
    echo "1. Review patch validation errors in /tmp/patch-validation.log"
    echo "2. Check context lines match pristine source"
    echo "3. Increase context lines (use diff -U 5 for 5 lines)"
    echo "4. Verify no whitespace differences (tabs vs spaces)"
    exit 1
  fi

  # Auto-fix: Try increasing context lines
  echo "→ Attempting auto-fix: increasing context lines..."
  diff -U 5 target-pristine.ext target-modified.ext > final-patch.patch

  sleep 2
  ITERATION=$((ITERATION + 1))
done
```

### Step 6: Reset and Persist

```bash
# Clean up test files
rm target-test.ext

# Copy validated patch to patches directory
cp final-patch.patch packages/node-smol-builder/patches/source-patched/NNN-patch-name.patch
```

## Patch List (13 Total)

Process in this exact order:

1. **001-common_gypi_fixes.patch** — common.gypi build configuration fixes
2. **002-polyfills.patch** — JavaScript polyfills for bootstrap
3. **003-fix_gyp_py3_hashlib.patch** — Python 3 hashlib fixes in GYP
4. **004-realm-vfs-binding.patch** — Realm integration for VFS binding
5. **005-node-gyp-vfs-binject.patch** — Add VFS/binject sources to node.gyp
6. **006-node-binding-vfs.patch** — VFS binding integration
7. **007-node-sea-smol-config-header.patch** — SEA SMOL configuration header
8. **008-node-sea-smol-config.patch** — SEA SMOL configuration implementation
9. **009-node-sea-header.patch** — SEA header modifications
10. **010-node-sea-bin-binject.patch** — SEA binary injection integration
11. **011-fix_v8_typeindex_macos.patch** — V8 type_index compatibility for macOS
12. **012-vfs_bootstrap.patch** — VFS bootstrap initialization
13. **013-vfs_require_resolve.patch** — VFS require resolution hooks

## Key Locations

```bash
# Patches directory (relative to repository root)
PATCHES_DIR="packages/node-smol-builder/patches/source-patched"

# Working directory for patch regeneration
WORK_DIR="/tmp/patch-rebuild"

# Node.js upstream
UPSTREAM_REPO="https://github.com/nodejs/node"
UPSTREAM_TAG="v25.5.0"
```

## Safety Checks

Before starting:
- [ ] Backup existing patches: `cp -r patches/source-patched patches/source-patched.backup-$(date +%Y%m%d-%H%M%S)`
- [ ] Reset upstream node submodule to SHA in .gitmodules: `NODE_SHA=$(git config -f .gitmodules submodule.packages/node-smol-builder/upstream/node.ref) && cd packages/node-smol-builder/upstream/node && git fetch && git checkout $NODE_SHA && cd -`
- [ ] Clean build artifacts and working directory: `pnpm --filter node-smol-builder run clean && rm -rf /tmp/patch-rebuild && mkdir -p /tmp/patch-rebuild`

After completion:
- [ ] All 13 patches generated
- [ ] Each patch validated with dry-run
- [ ] Git diff shows only intended changes
- [ ] Build test: `pnpm run clean && pnpm run build`

## Common Issues

### Issue: Patch fails to apply

**Cause**: Context lines don't match pristine file

**Solution**:
- Verify you're using pristine v25.5.0 source
- Increase context lines in diff (use `diff -U 5` for 5 lines)
- Check for whitespace differences (tabs vs spaces)

### Issue: Build fails after regenerating patches

**Cause**: Patch order dependency or incomplete change

**Solution**:
- Review build log for specific error
- Check that all source files are present in additions/
- Verify patch applies all necessary changes

### Issue: Patch header malformed

**Cause**: Using git diff instead of plain diff

**Solution**:
- Use `diff -u` not `git diff`
- Remove git metadata lines (index, ---a/, +++b/)
- Add custom Socket Security header comment block

## Example: Regenerating 005-node-gyp-vfs-binject.patch

```bash
cd /tmp/patch-rebuild

# 1. Get pristine node.gyp
gh repo clone nodejs/node node-pristine
cd node-pristine
git checkout v25.5.0
cp node.gyp ../node.gyp.pristine
cd ..

# 2. Read current patch to understand changes
cat packages/node-smol-builder/patches/source-patched/005-node-gyp-vfs-binject.patch

# 3. Create modified version
cp node.gyp.pristine node.gyp.modified

# Edit node.gyp.modified to add:
# - Socket Security sources array in node_use_lief condition
# - include_dirs configuration
# - direct_dependent_settings
# - -lcompression library flags

# 4. Generate patch
diff -u node.gyp.pristine node.gyp.modified > 005.diff

# 5. Add header
cat > 005-node-gyp-vfs-binject.patch << 'EOF'
# Socket Security: Add VFS and binject sources to node.gyp
#
# This patch integrates Socket Security's VFS and binject framework source files
# into the Node.js build system, including C/C++ sources and include directories.
#
# Files included:
# - Socket Security sea-smol wrapper (node_sea_smol.cc)
# - Socket Security VFS binding (node_vfs.cc)
# - binject core C sources and LIEF-based implementations
# - build-infra and bin-infra dependencies
#
# macOS Library Dependencies:
# - libcompression: Required for compression_common.c and gzip_compress.c
#
# Files modified:
# - node.gyp: Add binject and VFS source files, include directories, and libcompression
#
EOF

cat 005.diff >> 005-node-gyp-vfs-binject.patch

# 6. Normalize headers to a/b format
sed -i.bak 's|^--- node.gyp.pristine|--- a/node.gyp|; s|^+++ node.gyp.modified|+++ b/node.gyp|' 005-node-gyp-vfs-binject.patch
rm 005-node-gyp-vfs-binject.patch.bak

# 7. Validate
cp node.gyp.pristine node.gyp.test
patch --dry-run node.gyp.test < 005-node-gyp-vfs-binject.patch

# 8. If successful, persist
cp 005-node-gyp-vfs-binject.patch packages/node-smol-builder/patches/source-patched/
```

## Usage

```bash
# Regenerate all 13 patches (full workflow with backup and cleanup)
/node-patcher

# Regenerate a specific patch only (skips backup/cleanup)
/node-patcher 005
```

## Modes of Operation

### Full Mode (No Arguments)
When invoked without a patch number, regenerates all 13 patches with complete workflow:
- Backup existing patches with timestamp
- Reset upstream node submodule
- Clean build artifacts
- Setup working directory
- Process all 13 patches in sequence

### Single-Patch Mode (With Patch Number)
When invoked with a specific patch number (e.g., "005"), regenerates only that patch:
- Skip backup (faster, less disruptive)
- Skip cleanup (use existing environment)
- Setup working directory: `/tmp/patch-rebuild`
- Process only the specified patch
- Faster iteration when fixing a specific patch

## Post-Regeneration Steps

1. **Git Status**: Review all changed patches
   ```bash
   cd packages/node-smol-builder
   git status
   git diff patches/source-patched/
   ```

2. **Build Test**: Verify patches apply and build succeeds
   ```bash
   pnpm run clean
   rm -rf checkpoints/
   pnpm run build
   ```

3. **Commit**: Create atomic commit for patch regeneration
   ```bash
   git add patches/source-patched/
   git commit -m "refactor(patches): regenerate from pristine Node.js v25.5.0

   - Ensure all patches apply to unmodified upstream files
   - Remove dependencies between patches
   - Add proper context lines for stable application
   - Validate with dry-run tests"
   ```

## References

- Node.js v25.5.0 source: https://github.com/nodejs/node/tree/v25.5.0
- Socket BTM packages: packages/node-smol-builder/
- Patch directory: packages/node-smol-builder/patches/source-patched/
- Build script: packages/node-smol-builder/scripts/binary-released/

## Success Criteria

- ✅ All requested patches regenerated from pristine Node.js v25.5.0 source
- ✅ Each patch applies to unmodified upstream file (no dependencies)
- ✅ Each patch validated with `patch --dry-run` test
- ✅ Patches persisted to `patches/source-patched/` directory
- ✅ Patch headers include Socket Security comment blocks
- ✅ No code differences detected (patches apply cleanly)
- ✅ Backup created (full mode only)
- ✅ Working directory cleaned up
- ✅ `<promise>PATCH_REGEN_COMPLETE</promise>` emitted

## Completion Signal

Upon successful completion of patch regeneration, the skill emits:

```xml
<promise>PATCH_REGEN_COMPLETE</promise>
```

This signal indicates:
- All patches regenerated from pristine source
- Each patch validated with dry-run
- Patches persisted to patches directory
- Ready for build testing and commit
