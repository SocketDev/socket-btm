# Checkpoint Restoration Analysis

## Problem Summary

When GitHub Actions cache is valid and the build step is **skipped**, the workflows fail validation because:
1. Cache only restores `checkpoints/` directories (containing compressed `.tar.gz` files)
2. Validation steps expect files in `build/${BUILD_MODE}/out/Final/`
3. The final output files are **never extracted** from the checkpoint tarballs when using cached checkpoints

## Current State Across Workflows

### ✅ ONNX Runtime (`onnxruntime.yml`) - **FIXED**
**Status**: Now has restoration step added
**Final checkpoint**: `wasm-finalized.tar.gz` → contains `Final/` directory
**Files in Final**:
- `ort.wasm`
- `ort.mjs`
- `ort-sync.js`

**Fix Applied**:
```yaml
- name: Restore build output from checkpoint
  if: steps.onnx-checkpoint-cache.outputs.cache-hit == 'true' && steps.validate-cache.outputs.cache_valid == 'true'
  run: |
    CHECKPOINT_DIR="packages/onnxruntime-builder/build/${BUILD_MODE}/checkpoints"
    OUTPUT_DIR="packages/onnxruntime-builder/build/${BUILD_MODE}/out"
    tar -xzf "${CHECKPOINT_DIR}/wasm-finalized.tar.gz" -C "${OUTPUT_DIR}"
```

---

### ❌ Yoga Layout (`yoga-layout.yml`) - **NEEDS FIX**
**Status**: Missing restoration step
**Final checkpoint**: `wasm-finalized.tar.gz` → contains `Final/` directory
**Files in Final**:
- `yoga.wasm`
- `yoga.mjs`
- `yoga-sync.js`

**Issue**:
- Lines 233-239: Build step with condition
- Lines 241-269: Validation step runs **ALWAYS**
- When cache is valid, build is skipped but validation expects output files

**Needs**: Same restoration pattern as ONNX Runtime

---

### ❌ Models (`models.yml`) - **DIFFERENT PATTERN**
**Status**: Uses **dual cache strategy** but incomplete
**Caches**:
1. **Final cache** (line 159-165): Caches `build/${BUILD_MODE}/out/Final` directly
2. **Checkpoint cache** (line 167-173): Caches `build/${BUILD_MODE}/checkpoints`

**Files in Final**:
- `minilm-l6/model.onnx`
- `codet5/model.onnx`

**Issue**:
- Build condition (line 232): Only checks `final-cache`, ignores checkpoint cache
- Validation (line 237-275): Runs **ALWAYS** even if neither cache hit
- If final cache is invalid but checkpoint cache is valid, no restoration occurs

**Needs**: Different approach - either:
1. Use final cache only (remove checkpoint cache)
2. Add restoration step from checkpoint cache when final cache misses

---

### ❌ Node.js Smol (`node-smol.yml`) - **DIFFERENT ARCHITECTURE**
**Status**: More complex - per-platform/arch builds with different final phase
**Final checkpoint**: `binary-compressed.tar.gz` (NOT finalized)
**Cache strategy**: Only caches checkpoints (lines 335-343)

**Files in Final**:
- `node` (Unix)
- `node.exe` (Windows)

**Issue**:
- Build condition (line 416): Checks checkpoint cache
- No explicit validation step (goes straight to "Collect build metrics" line 430)
- Metrics collection (line 443-454): Checks if binary exists but doesn't fail
- Upload artifacts (line 458-464): Expects `Final/node` but has `if-no-files-found: error`

**Architecture differences**:
- Node.js has: `binary-released` → `binary-stripped` → `binary-compressed` → `finalized`
- The `binary-compressed` is the most complete checkpoint that should restore the final binary
- Unlike WASM builds, node-smol has platform-specific processing

**Needs**: Check if `binary-compressed` or another checkpoint contains the final binary

---

## Proposed Solution Pattern

### Standard Pattern (for WASM builds: ONNX, Yoga)

```yaml
- name: Build [Package]
  id: build
  if: steps.checkpoint-cache.outputs.cache-hit != 'true' || steps.validate-cache.outputs.cache_valid == 'false'
  run: pnpm --filter [package] build --$BUILD_MODE

- name: Restore build output from checkpoint
  if: steps.checkpoint-cache.outputs.cache-hit == 'true' && steps.validate-cache.outputs.cache_valid == 'true'
  env:
    BUILD_MODE: ${{ steps.build-mode.outputs.mode }}
  run: |
    echo "Restoring build output from checkpoint..."
    CHECKPOINT_DIR="packages/[package]/build/${BUILD_MODE}/checkpoints"
    OUTPUT_DIR="packages/[package]/build/${BUILD_MODE}/out"

    if [ -f "${CHECKPOINT_DIR}/wasm-finalized.tar.gz" ]; then
      mkdir -p "${OUTPUT_DIR}"
      tar -xzf "${CHECKPOINT_DIR}/wasm-finalized.tar.gz" -C "${OUTPUT_DIR}"
      echo "✅ Restored build output from checkpoint"
    else
      echo "❌ Checkpoint tarball not found"
      exit 1
    fi

- name: Validate build output
  run: |
    # Validation logic (runs always)
```

### For Models (dual cache strategy)

**Option A**: Remove checkpoint cache, use final cache only
```yaml
- name: Restore model Final cache
  id: model-final-cache
  with:
    path: packages/models/build/${{ steps.build-mode.outputs.mode }}/out/Final

- name: Build models
  if: steps.model-final-cache.outputs.cache-hit != 'true' || steps.validate-cache.outputs.cache_valid == 'false'
  run: pnpm --filter models build --$BUILD_MODE
```

**Option B**: Keep both, add restoration from checkpoint when final cache misses
```yaml
- name: Restore model Final cache
  id: model-final-cache
  # ... existing

- name: Restore model checkpoint cache
  id: model-checkpoint-cache
  # ... existing

- name: Restore from checkpoint if final cache missed
  if: |
    steps.model-final-cache.outputs.cache-hit != 'true' &&
    steps.model-checkpoint-cache.outputs.cache-hit == 'true'
  run: |
    # Extract from checkpoint
    CHECKPOINT_DIR="packages/models/build/${BUILD_MODE}/checkpoints"
    tar -xzf "${CHECKPOINT_DIR}/quantized.tar.gz" -C "packages/models/build/${BUILD_MODE}/out"

- name: Build models
  if: |
    steps.model-final-cache.outputs.cache-hit != 'true' &&
    steps.model-checkpoint-cache.outputs.cache-hit != 'true'
  run: pnpm --filter models build --$BUILD_MODE
```

### For Node.js Smol (needs investigation)

Need to determine:
1. Which checkpoint contains the final binary (`binary-compressed.tar.gz` or `finalized.tar.gz`)
2. Whether platform-specific processing happens after checkpoint creation
3. If restoration is even needed or if the build script handles it

---

## Implementation Plan

### Phase 1: Fix Yoga Layout (straightforward, same as ONNX)
- Add restoration step between build and validation
- Extract from `wasm-finalized.tar.gz`
- Test with cache hit scenario

### Phase 2: Investigate and Fix Models
- Decide on cache strategy (Option A or B)
- Models might not need checkpoint restoration if final cache works
- Current dual cache might be intentional for incremental builds

### Phase 3: Investigate Node.js Smol
- Check checkpoint contents to find which contains final binary
- Understand platform-specific build flow
- Add restoration step if needed

---

## Testing Strategy

For each workflow:
1. **First run**: Build from scratch, creates checkpoints
2. **Second run**: Cache hit, skip build
3. **Verify**: Artifacts upload succeeds
4. **Verify**: Final binaries are present and valid

---

## Key Insight

The issue is consistent across all builders that use checkpoints:
- **Checkpoint cache**: Stores incremental build states as tarballs
- **Build script**: Extracts checkpoints automatically when running
- **CI optimization**: Skips build when cache is valid
- **Missing link**: When build is skipped, checkpoints are never extracted

**Solution**: Explicitly extract the final checkpoint when using cached builds.
