# Progressive Checkpoint Restoration System

## Overview

The checkpoint system now supports **progressive restoration** - it walks backward through the checkpoint chain to find the latest valid checkpoint, restores from that point, and continues the build to complete any remaining checkpoints.

This enables **resumable builds** from any checkpoint, maximizing cache efficiency even with partial cache hits.

## How It Works

### Checkpoint Chain

Each package defines an ordered list of checkpoints (newest → oldest):

```
ONNX Runtime: wasm-finalized → wasm-synced → wasm-released → wasm-compiled
Yoga Layout:  wasm-finalized → wasm-synced → wasm-released → wasm-compiled → source-configured
Models:       quantized → converted → downloaded
Node.js Smol: finalized → binary-compressed → binary-stripped → binary-released → source-patched
```

### Progressive Restoration Algorithm

```
1. Start with newest checkpoint (e.g., wasm-finalized)
2. Check if it exists and is valid
3. If YES → restore from it and skip build (complete!)
4. If NO  → try next checkpoint (e.g., wasm-synced)
5. Repeat until a valid checkpoint is found
6. Restore from that checkpoint
7. Run build to complete remaining checkpoints
8. Save new checkpoints to cache
```

## Example Scenarios

### Scenario 1: Complete Cache (Best Case)

**Cached checkpoints:**
- ✅ wasm-compiled.tar.gz
- ✅ wasm-released.tar.gz
- ✅ wasm-synced.tar.gz
- ✅ wasm-finalized.tar.gz

**What happens:**
1. Restoration checks `wasm-finalized` → **Found!**
2. Extracts `wasm-finalized.tar.gz` → `out/Final/`
3. Build **skipped** (needs_build = false)
4. Validation passes
5. Upload artifacts

**Result:** ⚡ Fastest - no build at all!

---

### Scenario 2: Partial Cache (Middle Checkpoint)

**Cached checkpoints:**
- ✅ wasm-compiled.tar.gz
- ✅ wasm-released.tar.gz
- ❌ wasm-synced.tar.gz (missing)
- ❌ wasm-finalized.tar.gz (missing)

**What happens:**
1. Restoration checks `wasm-finalized` → Not found
2. Restoration checks `wasm-synced` → Not found
3. Restoration checks `wasm-released` → **Found!**
4. Extracts `wasm-released.tar.gz` → `out/Release/`
5. Build **runs** (needs_build = true) to complete:
   - wasm-synced phase
   - wasm-finalized phase
6. New checkpoints created and cached
7. Validation passes
8. Upload artifacts

**Result:** 🚀 Fast - skips expensive early phases (compilation)

---

### Scenario 3: Early Checkpoint Only

**Cached checkpoints:**
- ✅ wasm-compiled.tar.gz
- ❌ wasm-released.tar.gz (missing)
- ❌ wasm-synced.tar.gz (missing)
- ❌ wasm-finalized.tar.gz (missing)

**What happens:**
1. Restoration checks `wasm-finalized` → Not found
2. Restoration checks `wasm-synced` → Not found
3. Restoration checks `wasm-released` → Not found
4. Restoration checks `wasm-compiled` → **Found!**
5. Extracts `wasm-compiled.tar.gz` → `out/Compiled/`
6. Build **runs** (needs_build = true) to complete:
   - wasm-released phase
   - wasm-synced phase
   - wasm-finalized phase
7. New checkpoints created and cached

**Result:** ⏱️ Medium - skips only compilation, completes post-processing

---

### Scenario 4: No Cache (Worst Case)

**Cached checkpoints:**
- ❌ All missing

**What happens:**
1. Restoration finds no valid checkpoints
2. Build **runs from scratch** (needs_build = true)
3. Creates all checkpoints
4. Saves to cache

**Result:** 🐌 Slow - full build from source

---

## Benefits

### 1. Partial Cache Efficiency

**Before** (single checkpoint restoration):
```
Cache: wasm-released ✅  wasm-finalized ❌
Result: Full rebuild from scratch (wasm-released ignored)
```

**After** (progressive restoration):
```
Cache: wasm-released ✅  wasm-finalized ❌
Result: Restore wasm-released, resume from there
Saves: ~70% of build time (skips expensive compilation)
```

### 2. Resilience to Cache Invalidation

If only the final checkpoint is corrupted:
- **Before:** Full rebuild
- **After:** Restore from previous checkpoint, rebuild only final phase

### 3. Development Workflow Optimization

Developer changes final phase script:
- Cache: All checkpoints except `wasm-finalized` ✅
- Restoration: Finds `wasm-synced` ✅
- Build: Runs only `wasm-finalized` phase
- Time saved: 90%+ (skip compilation, optimization)

### 4. CI Optimization

CI runner has partial cache due to eviction:
- Old cache had all checkpoints
- New runner only has first 3 checkpoints
- Progressive restoration maximizes cache reuse
- Minimal rebuild time

## Checkpoint Chain Configuration

### ONNX Runtime

```yaml
checkpoint-chain: 'wasm-finalized,wasm-synced,wasm-released,wasm-compiled'
```

**Phases:**
1. `wasm-compiled` - WASM compilation with Emscripten
2. `wasm-released` - Copy compiled WASM to Release directory
3. `wasm-synced` - Generate synchronous wrapper
4. `wasm-finalized` - Copy to Final directory (contains `Final/`)

### Yoga Layout

```yaml
checkpoint-chain: 'wasm-finalized,wasm-synced,wasm-released,wasm-compiled,source-configured'
```

**Phases:**
1. `source-configured` - CMake configuration
2. `wasm-compiled` - WASM compilation
3. `wasm-released` - Release preparation
4. `wasm-synced` - Sync wrapper generation
5. `wasm-finalized` - Final output (contains `Final/`)

### Models

```yaml
checkpoint-chain: 'quantized,converted,downloaded'
```

**Phases:**
1. `downloaded` - Download models from Hugging Face
2. `converted` - Convert to ONNX format
3. `quantized` - Apply quantization (contains `Final/`)

### Node.js Smol

```yaml
checkpoint-chain: 'finalized,binary-compressed,binary-stripped,binary-released,source-patched'
```

**Phases:**
1. `source-patched` - Apply platform-specific patches
2. `binary-released` - Build Node.js binary
3. `binary-stripped` - Strip debug symbols
4. `binary-compressed` - Compress binary
5. `finalized` - Decompress to final binary (contains `Final/`)

## Action Outputs

The restoration action provides detailed outputs:

```yaml
outputs:
  restored: 'true'                    # Was any checkpoint restored?
  checkpoint-restored: 'wasm-synced'  # Which checkpoint was restored?
  checkpoint-index: '1'               # Index (0=newest, higher=older)
  needs-build: 'true'                 # Does build need to run?
```

### Build Condition

The build step uses the `needs-build` output:

```yaml
- name: Build
  if: |
    (steps.cache.outputs.cache-hit != 'true' || steps.validate.outputs.cache_valid == 'false') ||
    steps.restore-checkpoint.outputs.needs-build == 'true'
```

**Logic:**
- Run if: No cache OR invalid cache OR partial restoration (needs completion)
- Skip if: Valid cache AND latest checkpoint restored

## Detailed Flow Example

### ONNX Runtime with Partial Cache

**Initial state:**
```
Cache (from previous run):
├── wasm-compiled.tar.gz   ✅ Valid
├── wasm-released.tar.gz   ✅ Valid
└── wasm-synced.tar.gz     ❌ Missing (cache evicted)
```

**Restoration phase:**
```
🔗 Checkpoint chain:
  [0] wasm-finalized
  [1] wasm-synced
  [2] wasm-released
  [3] wasm-compiled

🔍 Checking [0] wasm-finalized... ⏭️ Not found
🔍 Checking [1] wasm-synced...    ⏭️ Not found
🔍 Checking [2] wasm-released...  ✅ Found!

✅ Restoring from: wasm-released (index 2)
📦 Extracted to: build/dev/out/Release/

⚙️ Build will run to complete:
   • wasm-synced (will be created)
   • wasm-finalized (will be created)
```

**Build phase:**
```
✓ Skip: wasm-compiled (already done, restored from cache)
✓ Skip: wasm-released (already done, restored from cache)
▶ Run:  wasm-synced (needs completion)
▶ Run:  wasm-finalized (needs completion)
```

**Result:**
```
New cache:
├── wasm-compiled.tar.gz   ✅ Reused from cache
├── wasm-released.tar.gz   ✅ Reused from cache
├── wasm-synced.tar.gz     ✅ Newly created
└── wasm-finalized.tar.gz  ✅ Newly created
```

**Time saved:** ~80% (skipped expensive WASM compilation)

## Best Practices

### 1. Order Checkpoints by Cost

Most expensive first in the chain:

```yaml
# Good: Expensive phases first
checkpoint-chain: 'final,optimized,compiled'

# Bad: Cheap phases first
checkpoint-chain: 'final,copied,compiled'
```

**Why?** If we can skip the expensive phase, we save the most time.

### 2. Include All Checkpoints

Don't skip intermediate checkpoints:

```yaml
# Good: Complete chain
checkpoint-chain: 'finalized,synced,released,compiled'

# Bad: Missing intermediate
checkpoint-chain: 'finalized,compiled'
```

**Why?** Progressive restoration won't find intermediate checkpoints if they're not in the chain.

### 3. Keep Chain in Sync with Build Script

The checkpoint chain should match the actual build phases:

```javascript
// build.mjs
await compileWasm()      // → wasm-compiled.tar.gz
await copyToRelease()    // → wasm-released.tar.gz
await generateSync()     // → wasm-synced.tar.gz
await finalize()         // → wasm-finalized.tar.gz
```

```yaml
# Matching workflow
checkpoint-chain: 'wasm-finalized,wasm-synced,wasm-released,wasm-compiled'
```

## Debugging

### View Restoration Output

The restoration action provides detailed logs:

```
🔗 Checkpoint chain (newest → oldest):
  [0] wasm-finalized
  [1] wasm-synced
  [2] wasm-released
  [3] wasm-compiled

🔍 Checking checkpoint [0]: wasm-finalized
   ⏭️  Not found, trying next...

🔍 Checking checkpoint [1]: wasm-synced
   ✓ Found: .../wasm-synced.tar.gz
   ✓ Integrity verified

✅ Found valid checkpoint: wasm-synced (index 1)

📦 Restoring from checkpoint: wasm-synced
📋 Checkpoint contents:
Sync/
Sync/ort.wasm
Sync/ort.mjs
Sync/ort-sync.js

⚙️ Build will run to complete remaining checkpoints:
   • wasm-finalized (will be created)
```

### Check Restoration Outputs

```yaml
- name: Debug restoration
  run: |
    echo "Restored: ${{ steps.restore-checkpoint.outputs.restored }}"
    echo "Checkpoint: ${{ steps.restore-checkpoint.outputs.checkpoint-restored }}"
    echo "Index: ${{ steps.restore-checkpoint.outputs.checkpoint-index }}"
    echo "Needs build: ${{ steps.restore-checkpoint.outputs.needs-build }}"
```

## Summary

**Progressive checkpoint restoration enables resumable builds from any checkpoint in the chain, maximizing cache efficiency and minimizing rebuild time.**

Key benefits:
- ✅ Partial cache hits are useful (not wasted)
- ✅ Resilient to cache corruption/eviction
- ✅ Optimizes development workflow (test final phase changes)
- ✅ Maximizes CI efficiency (resume from best available checkpoint)

The system automatically finds the latest valid checkpoint and resumes the build from there, saving significant time compared to full rebuilds.
