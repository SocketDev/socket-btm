# Checkpoint System Explained

## Core Concept

**We only cache checkpoints. The `Final/` output directory is always contained within the final checkpoint tarball.**

This ensures a single source of truth and eliminates any dual-caching complexity.

## What Gets Cached

```
GitHub Actions Cache (between workflow runs):
└── build/
    ├── shared/
    │   └── checkpoints/
    │       └── source-cloned.tar.gz
    └── {mode}/
        └── checkpoints/
            ├── wasm-compiled.tar.gz
            ├── wasm-released.tar.gz
            ├── wasm-synced.tar.gz
            └── wasm-finalized.tar.gz  ← Contains Final/ directory!
```

## Checkpoint Structure

Each final checkpoint contains the `Final/` directory with the build outputs:

### ONNX Runtime
```
wasm-finalized.tar.gz
└── Final/
    ├── ort.wasm
    ├── ort.mjs
    └── ort-sync.js
```

### Yoga Layout
```
wasm-finalized.tar.gz
└── Final/
    ├── yoga.wasm
    ├── yoga.mjs
    └── yoga-sync.js
```

### Models
```
quantized.tar.gz
└── Final/
    ├── minilm-l6/
    │   └── model.onnx
    └── codet5/
        └── model.onnx
```

### Node.js Smol
```
finalized.tar.gz
└── Final/
    └── node (or node.exe)
```

## The Flow

### Scenario 1: Cache Miss (First Build)

```
1. Cache restore
   └── MISS (no checkpoints found)

2. Build runs
   └── Creates: build/{mode}/checkpoints/wasm-finalized.tar.gz
       └── Contains: Final/ort.wasm, Final/ort.mjs, Final/ort-sync.js

3. Cache save (automatic at end of job)
   └── Saves: build/{mode}/checkpoints/*.tar.gz → GitHub Actions Cache

4. Upload artifacts
   └── From: build/{mode}/out/Final/
       (Build extracted the checkpoint to out/ during finalization)
```

### Scenario 2: Cache Hit (Subsequent Build)

```
1. Cache restore
   └── HIT (checkpoints restored)
   └── Downloads: build/{mode}/checkpoints/wasm-finalized.tar.gz

2. Validation
   └── Checks: checkpoint exists and is not corrupted

3. Build
   └── SKIPPED (cache valid)

4. Checkpoint restoration (our new action!)
   └── Extracts: build/{mode}/checkpoints/wasm-finalized.tar.gz
   └── To: build/{mode}/out/Final/

5. Upload artifacts
   └── From: build/{mode}/out/Final/
       (Restored from checkpoint)
```

## Key Insight

**The `out/Final/` directory is ephemeral** - it only exists during the workflow run:

- **Build scenario**: Created by build script during finalization phase
- **Cache scenario**: Extracted from checkpoint by restoration action

**The checkpoint tarballs are persistent** - they're the only thing cached between runs.

## Why This Design?

### 1. Single Source of Truth
- Only checkpoints are cached
- `Final/` is always derived from checkpoint
- No risk of cache inconsistency

### 2. Incremental Builds
- Build script can resume from any checkpoint
- Each checkpoint includes all previous work
- Failures can be recovered efficiently

### 3. Efficient Storage
- Checkpoints are compressed (tar.gz)
- Multiple checkpoints enable partial cache hits
- GitHub Actions cache limits are respected

### 4. Clear Separation
- **Checkpoints** = cached state between runs
- **out/Final/** = working directory during run
- **Artifacts** = uploaded results for download

## Verification Commands

Check what's inside each checkpoint:

```bash
# ONNX Runtime
tar -tzf packages/onnxruntime-builder/build/dev/checkpoints/wasm-finalized.tar.gz

# Yoga Layout
tar -tzf packages/yoga-layout-builder/build/dev/checkpoints/wasm-finalized.tar.gz

# Models (may not exist locally)
tar -tzf packages/models/build/dev/checkpoints/quantized.tar.gz

# Node.js Smol (may not exist locally)
tar -tzf packages/node-smol-builder/build/dev/checkpoints/finalized.tar.gz
```

All should show a `Final/` directory containing the build outputs.

## Common Misconceptions

### ❌ "We cache both checkpoints and Final output"
**No** - We only cache checkpoints. The Final output is inside the final checkpoint.

### ❌ "The restoration action is copying from cache"
**No** - The restoration action extracts from the checkpoint tarball that was already restored from cache.

### ❌ "We could just cache build/out/Final directly"
**No** - That would lose incremental build capability and waste cache space on multiple files instead of one compressed tarball.

## Benefits of Checkpoint-Only Caching

✅ **Simple**: One caching strategy across all workflows
✅ **Efficient**: Compressed storage, incremental builds
✅ **Reliable**: Single source of truth
✅ **Flexible**: Can resume from any checkpoint
✅ **Fast**: Cache hit = no build, just extraction
✅ **Debuggable**: Clear separation of concerns

## Summary

> **We only cache checkpoint tarballs. The Final output directory is always contained within the final checkpoint tarball and extracted when needed.**

This design ensures consistency, efficiency, and reliability across all build workflows.
