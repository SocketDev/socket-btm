# Checkpoint Caching System - Visual Diagram

## What We Cache (Checkpoint-Only)

```
╔════════════════════════════════════════════════════════════════╗
║  GitHub Actions Cache (Persistent Between Runs)                ║
╚════════════════════════════════════════════════════════════════╝
                              │
                              │ Stores only checkpoint tarballs
                              ▼
┌────────────────────────────────────────────────────────────────┐
│ build/{mode}/checkpoints/                                      │
│ ├── wasm-compiled.tar.gz                                       │
│ ├── wasm-released.tar.gz                                       │
│ ├── wasm-synced.tar.gz                                         │
│ └── wasm-finalized.tar.gz  ◄───── Contains Final/ inside!     │
│       └── Final/                                               │
│           ├── ort.wasm                                         │
│           ├── ort.mjs                                          │
│           └── ort-sync.js                                      │
└────────────────────────────────────────────────────────────────┘
```

## Cache Hit Flow (With Restoration)

```
┌─────────────────────────────────────────────────────────────────┐
│ Step 1: Restore Cache                                           │
├─────────────────────────────────────────────────────────────────┤
│ GitHub Actions Cache                                            │
│   └── wasm-finalized.tar.gz (compressed)                       │
│                │                                                │
│                │ Download & restore to runner                   │
│                ▼                                                │
│ Runner: build/dev/checkpoints/wasm-finalized.tar.gz            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ Cache hit = skip build
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 2: Validate Checkpoint                                     │
├─────────────────────────────────────────────────────────────────┤
│ ✓ Check file exists                                            │
│ ✓ Verify not corrupted (gzip -t)                               │
│ ✓ Check JSON metadata                                          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ Validation passed
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 3: Extract Checkpoint (Restoration Action)                │
├─────────────────────────────────────────────────────────────────┤
│ tar -xzf build/dev/checkpoints/wasm-finalized.tar.gz           │
│         -C build/dev/out/                                       │
│                │                                                │
│                │ Extracts                                       │
│                ▼                                                │
│ build/dev/out/Final/                                            │
│   ├── ort.wasm                                                  │
│   ├── ort.mjs                                                   │
│   └── ort-sync.js                                               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ Files ready
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 4: Validate & Upload                                      │
├─────────────────────────────────────────────────────────────────┤
│ ✓ Validate files exist                                         │
│ ✓ Check file sizes                                             │
│ ✓ Upload as artifacts                                          │
└─────────────────────────────────────────────────────────────────┘
```

## Cache Miss Flow (Build From Scratch)

```
┌─────────────────────────────────────────────────────────────────┐
│ Step 1: Restore Cache                                           │
├─────────────────────────────────────────────────────────────────┤
│ GitHub Actions Cache                                            │
│   └── (empty - no cache)                                       │
│                │                                                │
│                │ Cache miss                                     │
│                ▼                                                │
│ Runner: (no checkpoints)                                        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ Cache miss = run build
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 2: Build Runs                                             │
├─────────────────────────────────────────────────────────────────┤
│ pnpm --filter onnxruntime-builder build                        │
│                │                                                │
│                │ Creates checkpoints                            │
│                ▼                                                │
│ build/dev/checkpoints/wasm-finalized.tar.gz                    │
│   └── Contains: Final/ort.wasm, Final/ort.mjs, etc.           │
│                │                                                │
│                │ Also extracts to working directory             │
│                ▼                                                │
│ build/dev/out/Final/                                            │
│   ├── ort.wasm                                                  │
│   ├── ort.mjs                                                   │
│   └── ort-sync.js                                               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ Build complete
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 3: Validate & Upload                                      │
├─────────────────────────────────────────────────────────────────┤
│ ✓ Validate files exist                                         │
│ ✓ Check file sizes                                             │
│ ✓ Upload as artifacts                                          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ End of job
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 4: Save Cache (Automatic)                                 │
├─────────────────────────────────────────────────────────────────┤
│ GitHub Actions saves:                                           │
│   build/dev/checkpoints/*.tar.gz → Cache                       │
│                                                                 │
│ Does NOT save:                                                  │
│   build/dev/out/Final/ (ephemeral working directory)           │
└─────────────────────────────────────────────────────────────────┘
```

## Key Differences

### ❌ What We DON'T Do (Dual Caching)
```
Cache:
├── checkpoints/
│   └── wasm-finalized.tar.gz
└── out/Final/                    ◄── DON'T cache this separately!
    ├── ort.wasm
    ├── ort.mjs
    └── ort-sync.js
```

### ✅ What We DO (Checkpoint-Only)
```
Cache:
└── checkpoints/
    └── wasm-finalized.tar.gz
        └── (contains Final/ inside)

Working Directory (ephemeral):
└── out/Final/                    ◄── Extracted from checkpoint
    ├── ort.wasm
    ├── ort.mjs
    └── ort-sync.js
```

## Storage Comparison

### Before (Hypothetical Dual Cache)
```
Cache Size:
├── checkpoints/wasm-finalized.tar.gz: 6.5 MB (compressed)
└── out/Final/*.wasm + *.mjs + *.js:  23 MB (uncompressed)
Total: ~29.5 MB
```

### After (Checkpoint-Only)
```
Cache Size:
└── checkpoints/wasm-finalized.tar.gz: 6.5 MB (compressed)
Total: 6.5 MB

(out/Final/ not cached, always extracted from checkpoint)
```

**Result**: 4.5x smaller cache, no duplication!

## Summary

```
┌──────────────────────────────────────────────────────────────┐
│  Checkpoint = Single Source of Truth                         │
├──────────────────────────────────────────────────────────────┤
│  • Only checkpoints are cached                               │
│  • Final/ is always inside the final checkpoint tarball      │
│  • Extraction happens when cache is valid                    │
│  • Build script also creates Final/ when building from scratch│
│  • Result: Simple, efficient, consistent                     │
└──────────────────────────────────────────────────────────────┘
```
