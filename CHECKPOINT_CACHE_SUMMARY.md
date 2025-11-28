# Checkpoint Cache Summary by Package

## Overview

**NO** - Not all packages use shared checkpoints. Only packages that clone large upstream source repositories use the two-level checkpoint system.

## Package Comparison

| Package | Has Shared? | What's Cached | Reason |
|---------|-------------|---------------|--------|
| **ONNX Runtime** | ✅ Yes | `shared/` + `{mode}/` | Clones large ONNX Runtime repo (~442 MB) |
| **Yoga Layout** | ✅ Yes | `shared/` + `{mode}/` | Clones Yoga Layout repo (~2.5 MB) |
| **Node.js Smol** | ✅ Yes | `shared/` + `{mode}/` | Clones huge Node.js repo (varies by platform) |
| **Models** | ❌ No | `{mode}/` only | Downloads from Hugging Face, already mode-specific |

## Detailed Breakdown

### 1. ONNX Runtime (`onnxruntime-builder`)

**Cache Path:**
```yaml
path: |
  packages/onnxruntime-builder/build/shared/checkpoints
  packages/onnxruntime-builder/build/${{ mode }}/checkpoints
```

**Structure:**
```
shared/checkpoints/
└── source-cloned.tar.gz (442 MB) ← ONNX Runtime source from GitHub

dev/checkpoints/
├── wasm-compiled.tar.gz
├── wasm-released.tar.gz
├── wasm-synced.tar.gz
└── wasm-finalized.tar.gz

prod/checkpoints/
├── wasm-compiled.tar.gz
├── wasm-released.tar.gz
├── wasm-optimized.tar.gz (prod only)
├── wasm-synced.tar.gz
└── wasm-finalized.tar.gz
```

**Why shared?** The ONNX Runtime source code is large and identical for both dev and prod builds.

---

### 2. Yoga Layout (`yoga-layout-builder`)

**Cache Path:**
```yaml
path: |
  packages/yoga-layout-builder/build/shared/checkpoints
  packages/yoga-layout-builder/build/${{ mode }}/checkpoints
```

**Structure:**
```
shared/checkpoints/
└── source-cloned.tar.gz (2.5 MB) ← Yoga Layout source from GitHub

dev/checkpoints/
├── source-configured.tar.gz
├── wasm-compiled.tar.gz
├── wasm-released.tar.gz
├── wasm-synced.tar.gz
└── wasm-finalized.tar.gz

prod/checkpoints/
├── source-configured.tar.gz
├── wasm-compiled.tar.gz
├── wasm-released.tar.gz
├── wasm-optimized.tar.gz (prod only)
├── wasm-synced.tar.gz
└── wasm-finalized.tar.gz
```

**Why shared?** The Yoga Layout source is cloned from GitHub and is identical for both modes.

---

### 3. Node.js Smol (`node-smol-builder`)

**Cache Path:**
```yaml
path: |
  packages/node-smol-builder/build/shared/checkpoints
  packages/node-smol-builder/build/${{ mode }}/checkpoints
```

**Structure:**
```
shared/checkpoints/
└── source-cloned.tar.gz (size varies) ← Node.js source from GitHub

{mode}/checkpoints/
├── source-patched.tar.gz (platform-specific patches)
├── binary-released.tar.gz
├── binary-stripped.tar.gz
├── binary-compressed.tar.gz
└── finalized.tar.gz
```

**Why shared?** The base Node.js source is huge and identical across platforms/modes. Platform-specific patches are applied in mode-specific checkpoints.

**Special note:** Node.js Smol has per-platform/arch builds (darwin-arm64, linux-x64, etc.), so the cache key also includes platform and architecture.

---

### 4. Models (`models`)

**Cache Path:**
```yaml
path: packages/models/build/${{ mode }}/checkpoints
```

**Structure:**
```
dev/checkpoints/
├── downloaded.tar.gz
├── converted.tar.gz
└── quantized.tar.gz (int8 quantization)

prod/checkpoints/
├── downloaded.tar.gz
├── converted.tar.gz
└── quantized.tar.gz (int4 quantization)
```

**Why NO shared?**
- Models are downloaded from Hugging Face (not cloned from Git)
- Downloads are relatively small compared to source repos
- Quantization level (int4 vs int8) is mode-specific from the start
- No benefit to sharing - the entire pipeline is mode-specific

---

## Pattern Recognition

### Use Shared Checkpoints When:
✅ Cloning large source repository from Git
✅ Source code is identical across build modes
✅ Clone operation is expensive (time, bandwidth)
✅ Multiple build modes (dev/prod) or platforms

### Don't Use Shared Checkpoints When:
❌ Downloading artifacts (not cloning source)
❌ Source/inputs are mode-specific from the start
❌ Small download size (< 10 MB)
❌ No shared state between modes

## Cache Key Strategies

### With Shared Checkpoints
```yaml
key: package-${{ version }}-${{ os }}-${{ mode }}-${{ hash }}
     ↑                                  ↑
     Mode in key ensures dev/prod caches are separate,
     but both can share the same source-cloned checkpoint
```

### Without Shared Checkpoints
```yaml
key: package-${{ version }}-${{ mode }}-${{ hash }}
     ↑
     Mode-specific from the start
```

## Validation Differences

### With Shared Checkpoints
```bash
# Validate BOTH shared and mode-specific
if [ ! -f "shared/checkpoints/source-cloned.tar.gz" ]; then
  echo "❌ Shared checkpoint missing"
  exit 1
fi

if [ ! -f "${mode}/checkpoints/wasm-finalized.tar.gz" ]; then
  echo "❌ Mode checkpoint missing"
  exit 1
fi
```

### Without Shared Checkpoints
```bash
# Validate mode-specific only
if [ ! -f "${mode}/checkpoints/quantized.tar.gz" ]; then
  echo "❌ Checkpoint missing"
  exit 1
fi
```

## Migration Implications

If we wanted to standardize, we could:

### Option A: Always Use Shared (Not Recommended for Models)
```
models/
├── shared/checkpoints/
│   └── downloaded.tar.gz (but this is mode-specific!)
└── {mode}/checkpoints/
    ├── converted.tar.gz
    └── quantized.tar.gz
```
**Problem:** Models are downloaded with mode-specific quantization levels, so nothing is truly "shared".

### Option B: Keep Current (Recommended)
Use shared checkpoints only when there's actually shared state (source code).

## Summary Table

| Package | Shared? | Shared Contains | Mode Contains | Final Checkpoint |
|---------|---------|-----------------|---------------|------------------|
| **ONNX Runtime** | Yes | `source-cloned` | `wasm-*` | `wasm-finalized` |
| **Yoga Layout** | Yes | `source-cloned` | `wasm-*` | `wasm-finalized` |
| **Node.js Smol** | Yes | `source-cloned` | `binary-*`, `finalized` | `finalized` |
| **Models** | No | N/A | `downloaded`, `converted`, `quantized` | `quantized` |

## Conclusion

**No, not all packages use shared checkpoints.** Only packages that clone large upstream source repositories use the two-level system. The `models` package doesn't need it because it downloads mode-specific artifacts from the start.

This is the correct design - use shared checkpoints only when there's actually shared state worth caching.
