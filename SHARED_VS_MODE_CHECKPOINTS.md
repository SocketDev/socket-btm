# Shared vs Mode-Specific Checkpoints

## Overview

The checkpoint system uses **two levels** of checkpoints:
1. **Shared checkpoints** - Pristine source code shared across all build modes
2. **Mode-specific checkpoints** - Build artifacts specific to dev/prod

## Directory Structure

```
build/
├── shared/
│   └── checkpoints/
│       └── source-cloned.tar.gz       ← Shared across dev/prod
└── {mode}/                             ← dev or prod
    └── checkpoints/
        ├── wasm-compiled.tar.gz       ← Mode-specific
        ├── wasm-released.tar.gz       ← Mode-specific
        ├── wasm-synced.tar.gz         ← Mode-specific
        └── wasm-finalized.tar.gz      ← Mode-specific (contains Final/)
```

## Why Two Levels?

### Shared Checkpoints (`build/shared/checkpoints/`)

**Purpose**: Store pristine source code that's identical regardless of build mode

**Contents**:
- `source-cloned.tar.gz` - Freshly cloned source from upstream (e.g., ONNX Runtime repo)

**Why shared?**
- Dev and prod builds start from the **same source code**
- Cloning source is expensive (large repos, network I/O)
- Share once, reuse for both dev and prod builds
- Reduces cache size and build time

**Example** (ONNX Runtime):
```
source-cloned.tar.gz (442 MB)
└── Contains: Pristine ONNX Runtime source code
    - No build artifacts
    - No mode-specific modifications
    - Identical for dev and prod
```

### Mode-Specific Checkpoints (`build/{mode}/checkpoints/`)

**Purpose**: Store build artifacts that differ between dev and prod

**Contents** (varies by package):
- Compiled WASM files
- Optimized binaries
- Finalized outputs

**Why mode-specific?**
- Dev builds: Faster compilation, less optimization, debugging symbols
- Prod builds: Aggressive optimization, smaller size, no debug info
- Different compiler flags, optimization levels, feature flags

**Example** (ONNX Runtime):
```
build/dev/checkpoints/
├── wasm-compiled.tar.gz   (dev: -O2, debug symbols)
├── wasm-released.tar.gz
├── wasm-synced.tar.gz
└── wasm-finalized.tar.gz  (dev: 10 MB WASM)

build/prod/checkpoints/
├── wasm-compiled.tar.gz   (prod: -O3, optimizations)
├── wasm-released.tar.gz
├── wasm-optimized.tar.gz  (prod only: wasm-opt pass)
├── wasm-synced.tar.gz
└── wasm-finalized.tar.gz  (prod: 7 MB WASM)
```

## Cache Strategy

Both directories are cached together with a **mode-specific cache key**:

```yaml
- name: Restore checkpoint cache
  uses: actions/cache@...
  with:
    path: |
      packages/onnxruntime-builder/build/shared/checkpoints
      packages/onnxruntime-builder/build/${{ mode }}/checkpoints
    key: onnx-checkpoints-v1-${{ mode }}-${{ hash }}
```

### Cache Key Includes Mode

The cache key includes `${{ mode }}` (dev or prod), so:
- Dev builds restore: `shared/checkpoints/` + `dev/checkpoints/`
- Prod builds restore: `shared/checkpoints/` + `prod/checkpoints/`

### Cache Sharing Strategy

```
Run 1: Dev build
└── Creates cache:
    ├── shared/checkpoints/source-cloned.tar.gz
    └── dev/checkpoints/*.tar.gz

Run 2: Dev build again
└── Restores cache (exact match):
    ├── shared/checkpoints/source-cloned.tar.gz  ← Reused!
    └── dev/checkpoints/*.tar.gz                  ← Reused!

Run 3: Prod build
└── Creates NEW cache:
    ├── shared/checkpoints/source-cloned.tar.gz  ← Same as dev!
    └── prod/checkpoints/*.tar.gz                ← Different!
```

## Benefits of Two-Level Checkpoints

### 1. Avoid Duplicate Source Cloning
```
WITHOUT shared checkpoints:
├── dev cache:  source (442 MB) + dev artifacts (15 MB) = 457 MB
└── prod cache: source (442 MB) + prod artifacts (10 MB) = 452 MB
Total: 909 MB (442 MB duplicated!)

WITH shared checkpoints:
├── shared: source (442 MB)  ← Shared across both
├── dev:    dev artifacts (15 MB)
└── prod:   prod artifacts (10 MB)
Total: 467 MB (no duplication!)
```

### 2. Faster Cache Restoration

If source hasn't changed but build scripts changed:
- Shared checkpoint: **Cache hit** (skip source clone)
- Mode checkpoint: **Cache miss** (rebuild with new scripts)
- Result: Save time on slow source clone

### 3. Independent Build Modes

Dev and prod can evolve independently:
- Change dev build flags → invalidates dev cache only
- Change prod optimizations → invalidates prod cache only
- Source code update → invalidates shared cache (both rebuild)

## Validation

Both directories are validated together:

```bash
# Check shared checkpoint
if [ ! -f "shared/checkpoints/source-cloned.tar.gz" ]; then
  echo "❌ Shared checkpoint missing"
  rm -rf shared/checkpoints/ dev/checkpoints/
  exit 1
fi

# Check mode-specific checkpoints
if [ ! -f "dev/checkpoints/wasm-finalized.tar.gz" ]; then
  echo "❌ Dev checkpoint missing"
  rm -rf shared/checkpoints/ dev/checkpoints/
  exit 1
fi
```

## Package Comparison

### Packages with Shared Checkpoints

| Package | Shared Checkpoint | Why Shared? |
|---------|-------------------|-------------|
| **ONNX Runtime** | `source-cloned` | Large repo (442 MB), slow to clone |
| **Yoga Layout** | `source-cloned` | Clone from GitHub, shared source |
| **Node.js Smol** | `source-cloned` | Huge Node.js repo, expensive clone |

### Packages without Shared Checkpoints

| Package | Structure | Why No Shared? |
|---------|-----------|----------------|
| **Models** | Only `{mode}/checkpoints/` | Downloads from Hugging Face, already mode-specific (int4 vs int8) |

## Common Patterns

### WASM Builders (ONNX, Yoga)
```
shared/
└── source-cloned.tar.gz      ← Pristine source

dev/
├── wasm-compiled.tar.gz      ← Dev build artifacts
├── wasm-released.tar.gz
├── wasm-synced.tar.gz
└── wasm-finalized.tar.gz     ← Contains Final/ (dev mode)

prod/
├── wasm-compiled.tar.gz      ← Prod build artifacts
├── wasm-released.tar.gz
├── wasm-optimized.tar.gz     ← Prod only (wasm-opt)
├── wasm-synced.tar.gz
└── wasm-finalized.tar.gz     ← Contains Final/ (prod mode)
```

### Node.js Smol (Multi-platform)
```
shared/
└── source-cloned.tar.gz      ← Node.js source

{mode}/
└── checkpoints/
    ├── source-patched.tar.gz  ← Platform-specific patches
    ├── binary-released.tar.gz
    ├── binary-stripped.tar.gz
    ├── binary-compressed.tar.gz
    └── finalized.tar.gz       ← Contains Final/node
```

### Models (No Shared)
```
dev/
└── checkpoints/
    ├── downloaded.tar.gz
    ├── converted.tar.gz
    └── quantized.tar.gz       ← Contains Final/ (int8)

prod/
└── checkpoints/
    ├── downloaded.tar.gz
    ├── converted.tar.gz
    └── quantized.tar.gz       ← Contains Final/ (int4)
```

## Summary

> **Shared checkpoints** store pristine source code that's identical across build modes, avoiding duplication and reducing cache size.
>
> **Mode-specific checkpoints** store build artifacts that differ between dev and prod, allowing independent optimization strategies.

Both are cached together but with a mode-specific key, enabling efficient cache reuse while maintaining build mode independence.
