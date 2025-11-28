# Checkpoint Restoration: Local vs CI

This document explains how checkpoint restoration works differently in CI vs local builds.

## CI Workflow (GitHub Actions)

### 1. Cache Restoration
GitHub Actions restores checkpoint cache **before** extraction:

```yaml
- name: Restore checkpoint cache
  uses: actions/cache@v4
  with:
    path: |
      packages/node-smol-builder/build/shared/checkpoints
      packages/node-smol-builder/build/${{ mode }}/checkpoints
```

This restores **both** files for each checkpoint:
- `checkpoints/{package}/{phase}.json` (metadata)
- `checkpoints/{package}/{phase}.tar.gz` (tarball)

### 2. Validation
Workflow validates both files exist:

```yaml
- name: Validate checkpoint cache
  run: |
    if [ ! -f "${CHECKPOINT_JSON}" ]; then
      echo "::error::Checkpoint JSON not found"
      exit 1
    fi
    if [ ! -f "${CHECKPOINT_TAR}" ]; then
      echo "::error::Checkpoint tarball not found"
      exit 1
    fi
```

### 3. Progressive Restoration
The `restore-checkpoint` action walks backward through checkpoint chain:

```yaml
- name: Restore build output from checkpoint chain
  uses: ./.github/actions/restore-checkpoint
  with:
    checkpoint-chain: 'finalized,binary-compressed,binary-stripped,binary-released,source-patched,source-cloned'
```

It finds the **latest valid checkpoint** and extracts it:

```bash
# Walk backward through checkpoint chain
for CHECKPOINT in finalized binary-compressed binary-stripped ...; do
  # Check if checkpoint exists
  if [ -f "${CHECKPOINT_FILE}.tar.gz" ]; then
    # Verify tarball integrity
    if gzip -t "${CHECKPOINT_FILE}.tar.gz"; then
      # Extract to output directory
      tar -xzf "${CHECKPOINT_FILE}.tar.gz" -C "${OUTPUT_DIR}" --strip-components=1
      break
    fi
  fi
done
```

### 4. Build Phase Detection
When build runs, each phase checks if its checkpoint exists:

```javascript
// Build checks for checkpoint JSON (restored by cache)
if (!(await shouldRun(buildDir, packageName, 'finalized'))) {
  logger.success('Build already complete')
  return
}
```

**Result**: If cache hit + finalized checkpoint exists → entire build is skipped ✅

## Local Workflow (Without CI Cache)

### 1. No Cache Restoration
Local builds have **no checkpoint cache** initially.

On first build:
- Creates checkpoints as build progresses
- Each phase saves `.json` + `.tar.gz` locally

### 2. Source Restoration
When source needs to be reset (patches applied or dirty):

```javascript
async function resetNodeSource() {
  // Restore from checkpoint (deletes old dir, extracts fresh)
  const restored = await restoreCheckpoint(
    sharedBuildDir,
    packageName,
    'source-cloned',
    { destDir: buildDir },
  )

  if (!restored) {
    throw new Error('Failed to restore source from checkpoint')
  }
}
```

The `restoreCheckpoint()` function:
1. Deletes the existing target directory (`build/dev/source/`)
2. Extracts the checkpoint tarball to recreate it with pristine contents
3. Ensures clean state for patch application

### 3. Checkpoint Dependency
Local builds **require** the `source-cloned` checkpoint to exist before source can be reset:

1. Clones source to `build/shared/source/`
2. Creates `source-cloned` checkpoint (tarball + JSON)
3. When mode source needs resetting:
   - Restores from `source-cloned` checkpoint tarball ✅
   - Deletes and recreates directory with pristine contents ✅

On subsequent builds (checkpoints exist):
1. Source reset uses checkpoint restoration ✅
2. Phase skipping works via `shouldRun()` checking `.json` files ✅

### 4. Progressive Checkpoint Usage
Local builds accumulate checkpoints over time:

**First build (--clean)**:
```
No checkpoints → Build from scratch
├─ Creates source-cloned checkpoint
├─ Creates source-patched checkpoint
├─ Creates binary-released checkpoint
├─ Creates binary-stripped checkpoint
├─ Creates binary-compressed checkpoint
└─ Creates finalized checkpoint
```

**Second build** (same config):
```
finalized checkpoint exists → Skip entire build ✅
```

**Third build** (--clean):
```
Checkpoints deleted → Build from scratch again
```

**Fourth build** (modify patches):
```
source-patched invalidated → Resume from source-cloned checkpoint ✅
└─ Restores source-cloned
└─ Re-applies patches (new hash)
└─ Continues build from there
```

## Key Differences

| Aspect | CI (GitHub Actions) | Local Builds |
|--------|-------------------|--------------|
| **Cache Source** | GitHub Actions cache | Local filesystem |
| **Restoration** | Extracts from tarball (deletes old, extracts new) | Same - extracts from tarball |
| **Fallback** | Fails if tarball corrupted | Fails if tarball missing/corrupted |
| **Validation** | Strict (requires both .json + .tar.gz) | Same - requires checkpoint to exist |
| **Progressive Restoration** | Walks backward through chain | Same |
| **First Build** | Usually cache miss → build from scratch | Always builds from scratch (no cache) |
| **Subsequent Builds** | Cache hit → restore latest checkpoint | Uses local checkpoints from previous build |

## Example: Local Build Progression

### First Build (Fresh Clone)
```bash
pnpm --filter node-smol-builder build --dev
```

**Flow**:
1. No checkpoints exist
2. Clones source → creates `source-cloned` checkpoint
3. Applies patches → creates `source-patched` checkpoint
4. Builds release → creates `binary-released` checkpoint
5. Strips binary → creates `binary-stripped` checkpoint
6. Compresses binary → creates `binary-compressed` checkpoint
7. Finalizes → creates `finalized` checkpoint

**Checkpoints Created**:
```
build/
├─ shared/
│  └─ checkpoints/
│     └─ node-smol-builder/
│        ├─ source-cloned.json
│        └─ source-cloned.tar.gz (123MB)
└─ dev/
   └─ checkpoints/
      └─ node-smol-builder/
         ├─ source-patched.json
         ├─ source-patched.tar.gz (123MB)
         ├─ binary-released.json
         ├─ binary-released.tar.gz (90MB)
         ├─ binary-stripped.json
         ├─ binary-stripped.tar.gz (55MB)
         ├─ binary-compressed.json
         ├─ binary-compressed.tar.gz (28MB)
         ├─ finalized.json
         └─ finalized.tar.gz (28MB)
```

### Second Build (No Changes)
```bash
pnpm --filter node-smol-builder build --dev
```

**Flow**:
1. `shouldRun(buildDir, 'finalized')` → false (checkpoint exists)
2. **Build skipped entirely** ✅

**Output**:
```
→ Build Already Complete
✓ finalized checkpoint exists, skipping
✓ Build already complete
```

### Third Build (Source Modified)
```bash
# Modify a patch file
pnpm --filter node-smol-builder build --dev
```

**Flow**:
1. `shouldRun(buildDir, 'finalized')` → true (cache hash changed)
2. Restores from earlier checkpoint:
   - Checks `finalized` → hash mismatch
   - Checks `binary-compressed` → hash mismatch
   - Checks `binary-stripped` → hash mismatch
   - Checks `binary-released` → hash mismatch
   - Checks `source-patched` → hash mismatch
   - Uses `source-cloned` → hash valid ✅
3. Restores `source-cloned` checkpoint
4. Continues build from patch application

**Output**:
```
→ Using Existing Node.js Source
⚠️  Source exists but patches need to be applied - restoring pristine source
  Restoring checkpoint 'source-cloned'
  Extracting checkpoint.tar.gz (123.01 MB)...
✓ Source restored from checkpoint
→ Applying Socket Patches
  ...continues from here
```

## Summary

Both CI and local builds use the **identical checkpoint system**:

**Checkpoint Restoration** (same for CI and local):
1. Deletes existing target directory
2. Extracts checkpoint tarball to recreate with pristine contents
3. Fails if checkpoint doesn't exist or is corrupted
4. Progressive restoration walks backward through checkpoint chain

**Key Difference**:
- **CI**: Checkpoints restored from GitHub Actions cache
- **Local**: Checkpoints created and stored on local filesystem

Both require checkpoints to exist for restoration. The `source-cloned` checkpoint is always created during the first build phase, so it's guaranteed to exist when `resetNodeSource()` needs it later in the build.
