# regenerating-node-patches Reference Documentation

This document provides detailed edge cases, troubleshooting procedures, and advanced topics for the regenerating-node-patches skill.

## Table of Contents

1. [Edge Cases](#edge-cases)
2. [Rollback Procedures](#rollback-procedures)
3. [Retry Logic](#retry-logic)
4. [Patch Format Details](#patch-format-details)
5. [Common Failure Modes](#common-failure-modes)
6. [Variable Persistence](#variable-persistence)
7. [Cross-Platform Considerations](#cross-platform-considerations)

---

## Edge Cases

### Timestamp Collision

**Scenario:** Multiple patches regenerated in same second, backup timestamps collide.

**Solution:** Add retry loop with incrementing suffix:

```bash
PATCH_NAME="001-common_gypi_fixes.patch"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_NAME="$PATCH_NAME.backup-$TIMESTAMP"
COUNTER=1

# Retry up to 10 times if backup already exists
while [ -f "packages/node-smol-builder/patches/source-patched/$BACKUP_NAME" ]; do
  BACKUP_NAME="$PATCH_NAME.backup-$TIMESTAMP-$COUNTER"
  COUNTER=$((COUNTER + 1))
  if [ $COUNTER -gt 10 ]; then
    echo "ERROR: Could not create unique backup filename after 10 attempts"
    exit 1
  fi
done

cp packages/node-smol-builder/patches/source-patched/$PATCH_NAME \
   packages/node-smol-builder/patches/source-patched/$BACKUP_NAME
```

**Likelihood:** Low (requires regenerating patches faster than 1 per second)

---

### Upstream Submodule Not Initialized

**Scenario:** Submodule directory missing or empty.

**Detection:**
```bash
if [ ! -d "packages/node-smol-builder/upstream/node/.git" ]; then
  echo "ERROR: Upstream Node.js submodule not initialized"
  exit 1
fi
```

**Solution:**
```bash
git submodule update --init --recursive packages/node-smol-builder/upstream/node
cd packages/node-smol-builder/upstream/node
git fetch origin --tags
git checkout v25.5.0
cd ../../..
```

**Prevention:** Validate submodule state in Phase 1 before spawning agent.

---

### Patch Target File Not Found

**Scenario:** Patch references file that doesn't exist in upstream Node.js v25.5.0.

**Detection:**
```bash
TARGET_FILE="common.gypi"
if [ ! -f "packages/node-smol-builder/upstream/node/$TARGET_FILE" ]; then
  echo "ERROR: Target file not found: $TARGET_FILE"
  echo "Node.js version: $(cd packages/node-smol-builder/upstream/node && git describe --tags)"
  exit 1
fi
```

**Common Causes:**
- File moved or renamed in new Node.js version
- Patch references wrong file path
- Upstream not at correct tag (v25.5.0)

**Solution:** Update patch to reference correct file path in new Node.js version.

---

### Patch Validation Fails

**Scenario:** `patch --dry-run` fails because patch doesn't apply cleanly.

**Diagnostic Steps:**

1. **Verify pristine state:**
   ```bash
   cd packages/node-smol-builder/upstream/node
   git status  # Should be clean
   git diff    # Should be empty
   ```

2. **Check patch format:**
   ```bash
   head -20 /tmp/patch-rebuild/final-patch.patch
   ```
   Verify:
   - Headers: `--- a/FILE` and `+++ b/FILE`
   - Hunks: `@@ -LINE,COUNT +LINE,COUNT @@`
   - Context lines match pristine file

3. **Manual validation:**
   ```bash
   cd packages/node-smol-builder/upstream/node
   patch --verbose --dry-run < ../../patches/source-patched/001-common_gypi_fixes.patch
   ```

**Common Causes:**
- Wrong context lines (file changed in v25.5.0)
- Line endings (CRLF vs LF)
- Trailing whitespace
- Incorrect diff format (used `git diff` instead of `diff`)

**Solution:** Regenerate patch manually with correct modifications.

---

### Socket Security Headers Missing

**Scenario:** Original patch headers (comments) not preserved in regenerated patch.

**Detection:**
```bash
if ! grep -q "# Socket Security:" /tmp/patch-rebuild/final-patch.patch; then
  echo "WARNING: Socket Security header missing from patch"
fi
```

**Solution:** Read original patch header and include in new patch:

```bash
# Extract header (lines starting with #)
grep "^#" packages/node-smol-builder/patches/source-patched/$PATCH_NAME > /tmp/patch-header.txt

# Create new patch with header
cat /tmp/patch-header.txt > /tmp/patch-rebuild/final-patch.patch
cat /tmp/patch-rebuild/raw-patch.diff >> /tmp/patch-rebuild/final-patch.patch
```

---

## Rollback Procedures

### Rollback Single Patch

**Scenario:** Regenerated patch is broken, need to restore backup.

**Steps:**
```bash
PATCH_NAME="001-common_gypi_fixes.patch"

# List available backups
ls -lt packages/node-smol-builder/patches/source-patched/$PATCH_NAME.backup-*

# Restore most recent backup
LATEST_BACKUP=$(ls -t packages/node-smol-builder/patches/source-patched/$PATCH_NAME.backup-* | head -1)
cp "$LATEST_BACKUP" packages/node-smol-builder/patches/source-patched/$PATCH_NAME

echo "Restored: $LATEST_BACKUP → $PATCH_NAME"
```

**Verification:**
```bash
cd packages/node-smol-builder/upstream/node
git reset --hard v25.5.0
cd -

# Test patch applies
cd packages/node-smol-builder/upstream/node
patch --dry-run < ../../patches/source-patched/$PATCH_NAME
cd -
```

---

### Rollback All Patches

**Scenario:** Regeneration failed for multiple patches, restore all from backups.

**Steps:**
```bash
TIMESTAMP="20260206-103045"  # Use timestamp from backup filenames

cd packages/node-smol-builder/patches/source-patched/

for backup in *.backup-$TIMESTAMP; do
  original="${backup%.backup-$TIMESTAMP}"
  echo "Restoring: $backup → $original"
  cp "$backup" "$original"
done

cd ../../..
```

**Verification:**
```bash
cd packages/node-smol-builder
pnpm run build:patches
```

---

### Remove Failed Regeneration Artifacts

**Scenario:** Clean up after failed regeneration attempt.

**Steps:**
```bash
# Clean workspace
rm -rf /tmp/patch-rebuild

# Reset upstream to pristine
cd packages/node-smol-builder/upstream/node
git reset --hard v25.5.0
git clean -fd
cd ../../..

# Remove partial changes
git restore packages/node-smol-builder/patches/source-patched/*.patch
```

---

## Retry Logic

### Patch Application Retry

**Scenario:** `patch --dry-run` occasionally fails due to transient issues.

**Implementation:**
```bash
MAX_RETRIES=3
RETRY_COUNT=0

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
  if patch --dry-run test-$TARGET_FILE < final-patch.patch 2>&1 | tee /tmp/patch-retry.log; then
    echo "✓ Patch validated successfully"
    break
  fi

  RETRY_COUNT=$((RETRY_COUNT + 1))
  if [ $RETRY_COUNT -eq $MAX_RETRIES ]; then
    echo "✗ ERROR: Patch validation failed after $MAX_RETRIES attempts"
    cat /tmp/patch-retry.log
    exit 1
  fi

  echo "Retry $RETRY_COUNT/$MAX_RETRIES in 2 seconds..."
  sleep 2
done
```

**When to Use:** Only for transient failures (file system, race conditions). Do NOT retry for actual patch format errors.

---

### File System Sync

**Scenario:** File system operations need time to propagate.

**Implementation:**
```bash
# After creating file
echo "$NEW_VERSION" > /tmp/patch-rebuild/modified-$TARGET_FILE

# Sync to disk
sync

# Verify file exists and is readable
if [ ! -f "/tmp/patch-rebuild/modified-$TARGET_FILE" ]; then
  echo "ERROR: File creation failed"
  exit 1
fi

# Small delay for NFS/network file systems
sleep 0.1
```

---

## Patch Format Details

### Standard Unified Diff Format

**Correct Format (used by `diff -u`):**
```patch
# Socket Security: Fix common.gypi for macOS builds
# This patch fixes V8 typeindex issues on macOS.
# Files modified: common.gypi

--- a/common.gypi
+++ b/common.gypi
@@ -145,6 +145,9 @@
     ['OS=="mac"', {
       'defines': [
         '_DARWIN_USE_64_BIT_INODE=1',
+        # Fix for V8 typeindex on macOS
+        'V8_COMPRESS_POINTERS',
+        'V8_31BIT_SMIS_ON_64BIT_ARCH',
       ],
     }],
   }],
```

**Key Elements:**
- Comment headers (lines starting with `#`)
- File paths: `--- a/FILE` and `+++ b/FILE`
- Hunk header: `@@ -OLD_START,OLD_COUNT +NEW_START,NEW_COUNT @@`
- Context lines: unchanged lines
- Removed lines: start with `-`
- Added lines: start with `+`
- Minimum 3 context lines before/after changes

---

### Git Diff Format (INCORRECT - Do Not Use)

**Why Git Diff Fails:**
```diff
diff --git a/common.gypi b/common.gypi
index abc123..def456 100644
--- a/common.gypi
+++ b/common.gypi
```

**Problems:**
- `diff --git` header incompatible with `patch` command
- `index` line references git objects (not portable)
- Requires git repository context

**Fix:** Use `diff -u` instead of `git diff`.

---

### Header Normalization

**Workspace Filenames to Standard Format:**

```bash
# Before normalization
--- pristine-common.gypi    2024-01-15 10:30:00.000000000 -0800
+++ modified-common.gypi    2024-01-15 10:35:00.000000000 -0800

# After normalization
--- a/common.gypi
+++ b/common.gypi
```

**Sed Command:**
```bash
sed -i.bak "s|^--- pristine-|--- a/|; s|^+++ modified-|+++ b/|" final-patch.patch
rm final-patch.patch.bak
```

**Why Normalize:** Standard format works with `patch` command without specifying strip level.

---

## Common Failure Modes

### Mode 1: Forgot to Reset Upstream Between Patches

**Symptom:** Second patch applies to modified upstream (not pristine).

**Detection:**
```bash
cd packages/node-smol-builder/upstream/node
if [ -n "$(git status --porcelain)" ]; then
  echo "ERROR: Upstream has uncommitted changes"
  git status
  exit 1
fi
```

**Impact:** Patch depends on previous patch (breaks independence).

**Prevention:** Always reset to v25.5.0 at start of Step 2.

---

### Mode 2: Used Git Diff Instead of Diff

**Symptom:** Patch file contains `diff --git` header.

**Detection:**
```bash
if grep -q "^diff --git" /tmp/patch-rebuild/final-patch.patch; then
  echo "ERROR: Patch uses git diff format (incompatible with patch command)"
  exit 1
fi
```

**Fix:** Regenerate using `diff -u pristine modified`.

---

### Mode 3: Workspace State Leaked Between Patches

**Symptom:** Workspace from patch N affects patch N+1.

**Detection:**
```bash
if [ -d "/tmp/patch-rebuild" ]; then
  echo "ERROR: Workspace not cleaned from previous patch"
  exit 1
fi
```

**Impact:** File contamination, wrong modifications.

**Prevention:** Always `rm -rf /tmp/patch-rebuild` at end of Step 8.

---

### Mode 4: Backup Overwritten Without Notice

**Symptom:** Regeneration fails, backup already overwritten.

**Prevention:**
```bash
# Check if backup exists before creating new one
if [ -f "packages/node-smol-builder/patches/source-patched/$PATCH_NAME.backup-$TIMESTAMP" ]; then
  echo "WARNING: Backup already exists: $PATCH_NAME.backup-$TIMESTAMP"
  echo "Using incremental suffix..."
  TIMESTAMP="$TIMESTAMP-$RANDOM"
fi
```

---

## Variable Persistence

### Bash Session State

**Problem:** Variables defined in one bash invocation are not available in next invocation.

**Example (BROKEN):**
```bash
# First bash call
PATCH_NAME="001-common_gypi_fixes.patch"

# Second bash call (PATCH_NAME is empty!)
echo "$PATCH_NAME"  # ERROR: empty
```

**Solutions:**

1. **Pass variables in same bash session:**
   ```bash
   PATCH_NAME="001-common_gypi_fixes.patch" && \
   TIMESTAMP=$(date +%Y%m%d-%H%M%S) && \
   cp packages/node-smol-builder/patches/source-patched/$PATCH_NAME \
      packages/node-smol-builder/patches/source-patched/$PATCH_NAME.backup-$TIMESTAMP
   ```

2. **Store in temporary file:**
   ```bash
   # First bash call
   echo "001-common_gypi_fixes.patch" > /tmp/current-patch.txt

   # Second bash call
   PATCH_NAME=$(cat /tmp/current-patch.txt)
   ```

3. **Use inline variables:**
   ```bash
   # Define variable inline for each command
   for PATCH_NAME in 001-common_gypi_fixes.patch 002-polyfills.patch; do
     # Variable scoped to this iteration
     echo "Processing: $PATCH_NAME"
   done
   ```

**Best Practice:** Keep related operations in single bash invocation when variables are needed across multiple commands.

---

## Cross-Platform Considerations

### macOS vs Linux Differences

**1. sed -i Behavior:**

macOS (BSD sed):
```bash
sed -i.bak "s/old/new/" file.txt  # Creates file.txt.bak
rm file.txt.bak
```

Linux (GNU sed):
```bash
sed -i "s/old/new/" file.txt  # No backup created
```

**Portable Solution:**
```bash
# Works on both macOS and Linux
sed -i.bak "s/old/new/" file.txt && rm file.txt.bak
```

---

**2. date Command:**

macOS:
```bash
date +%Y%m%d-%H%M%S  # Works
date -d "yesterday"  # ERROR: -d not supported
```

Linux:
```bash
date +%Y%m%d-%H%M%S  # Works
date -d "yesterday"  # Works
```

**Portable Solution:** Use format strings only, avoid relative date parsing.

---

**3. diff Command:**

Both macOS and Linux support `diff -u` (unified format):
```bash
diff -u pristine modified  # Works on both
```

Context lines default:
- macOS: 3 lines
- Linux: 3 lines
- Explicit: `diff -U 5` for 5 lines of context

---

**4. patch Command:**

Both support standard unified diff format:
```bash
patch --dry-run file.txt < changes.patch  # Works on both
```

**Differences:**
- GNU patch: More verbose output
- BSD patch: Less verbose output

**Portable Solution:** Redirect stderr to capture all output:
```bash
patch --dry-run file.txt < changes.patch 2>&1 | tee /tmp/patch-output.log
```

---

## Advanced Topics

### Parallel Patch Regeneration

**Scenario:** Regenerate multiple patches in parallel (faster).

**Safety Warning:** NOT RECOMMENDED - patches share workspace and upstream state.

**If Required:**
```bash
# Each patch needs isolated workspace and upstream clone
for i in 1 2 3; do
  mkdir -p /tmp/patch-rebuild-$i
  git clone --shared packages/node-smol-builder/upstream/node /tmp/node-$i
done

# Regenerate patches in parallel
for PATCH in 001 002 003; do
  (
    # Isolated workspace
    WORKSPACE="/tmp/patch-rebuild-${PATCH:0:1}"
    NODE_CLONE="/tmp/node-${PATCH:0:1}"
    # ... regenerate patch ...
  ) &
done
wait
```

**Complexity:** High - requires careful isolation. **Recommendation:** Stick to sequential regeneration.

---

### Conditional Patch Regeneration

**Scenario:** Only regenerate patches that are broken (not all 13).

**Detection:**
```bash
cd packages/node-smol-builder/upstream/node
git reset --hard v25.5.0

BROKEN_PATCHES=()
for patch in ../../patches/source-patched/*.patch; do
  if ! patch --dry-run -p1 < "$patch" 2>/dev/null; then
    BROKEN_PATCHES+=("$(basename $patch)")
  fi
done

echo "Broken patches: ${BROKEN_PATCHES[@]}"
```

**Regeneration:**
```bash
for patch_name in "${BROKEN_PATCHES[@]}"; do
  echo "Regenerating: $patch_name"
  # ... follow 8-step workflow for this patch ...
done
```

**Use Case:** When upgrading Node.js and only some patches need updates.

---

### Automated Testing

**Scenario:** Verify patches apply cleanly in CI/CD.

**Test Script:**
```bash
#!/bin/bash
set -e

cd packages/node-smol-builder/upstream/node
git reset --hard v25.5.0

FAILED=0
for patch in ../../patches/source-patched/*.patch; do
  echo "Testing: $(basename $patch)"
  if ! patch --dry-run -p1 < "$patch"; then
    echo "FAILED: $(basename $patch)"
    FAILED=$((FAILED + 1))
  fi
  # Reset for next patch
  git reset --hard v25.5.0
  git clean -fd
done

if [ $FAILED -gt 0 ]; then
  echo "❌ $FAILED patches failed validation"
  exit 1
else
  echo "✅ All patches validated successfully"
fi
```

**Integration:** Add to CI pipeline to catch patch regressions early.

---

## Troubleshooting Checklist

When patch regeneration fails, check:

- [ ] Upstream at correct tag (v25.5.0)?
- [ ] Workspace clean (`/tmp/patch-rebuild` removed)?
- [ ] Upstream pristine (no uncommitted changes)?
- [ ] Backup created before overwriting?
- [ ] Target file exists in upstream?
- [ ] Used `diff -u` (not `git diff`)?
- [ ] Socket Security headers preserved?
- [ ] Patch validates with `patch --dry-run`?
- [ ] Line endings consistent (LF not CRLF)?
- [ ] No trailing whitespace in diff?

Run through checklist systematically to identify root cause.
