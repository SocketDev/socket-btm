# node-smol-builder Build System

This document describes the build directory structure and progressive build pipeline for node-smol-builder.

## Quick Reference

```bash
pnpm run build           # Build with checkpoints (incremental)
pnpm run build --force   # Force full rebuild
pnpm run build --dev     # Development build (default locally)
pnpm run build --prod    # Production build (default in CI)
pnpm run clean           # Clean all build artifacts and checkpoints
```

## Directory Structure

```
packages/node-smol-builder/build/
├── shared/                        # Shared across dev/prod builds
│   ├── source/                    # Shared patched Node.js source
│   └── checkpoints/               # source-copied, source-patched
│
├── dev/                           # Development build workspace
│   ├── source/                    # Dev build source tree
│   ├── .cache/                    # Ninja compilation cache
│   ├── checkpoints/               # Dev checkpoints (tarball snapshots)
│   │   ├── source-patched.tar.gz    # Source with patches applied (~136MB)
│   │   ├── binary-released.tar.gz   # Compiled binary (~28MB)
│   │   ├── binary-stripped.tar.gz   # Debug symbols stripped (~23MB)
│   │   ├── binary-compressed.tar.gz # LZFSE compressed (~22MB)
│   │   └── finalized.tar.gz         # Final production binary (~22MB)
│   │
│   └── out/                       # Build outputs (actual binaries)
│       ├── Release/node/node      # Compiled with debug symbols (~98MB)
│       ├── Stripped/node/node     # Symbols stripped (~64MB)
│       ├── Compressed/node/node   # LZFSE self-extracting (~23MB)
│       └── Final/node/node        # Production-ready binary (~23MB)
│
└── prod/                          # Production build workspace
    └── [same structure as dev]
```

## Build Stages

The build pipeline processes Node.js through these stages:

| Stage | Checkpoint | Output | Size | Description |
|-------|------------|--------|------|-------------|
| **source-copied** | `source-copied.tar.gz` | `shared/source/` | ~500MB | Copy upstream Node.js source |
| **source-patched** | `source-patched.tar.gz` | `{mode}/source/` | ~136MB | Apply Socket Security patches |
| **binary-released** | `binary-released.tar.gz` | `out/Release/` | ~98MB | Ninja compilation with debug symbols |
| **binary-stripped** | `binary-stripped.tar.gz` | `out/Stripped/` | ~64MB | Strip debug symbols |
| **binary-compressed** | `binary-compressed.tar.gz` | `out/Compressed/` | ~23MB | LZFSE self-extracting compression |
| **finalized** | `finalized.tar.gz` | `out/Final/` | ~23MB | Production-ready binary |

## Checkpoints

Checkpoints are tarball snapshots that enable incremental builds:

- Each stage saves a `.tar.gz` checkpoint after completion
- Subsequent builds skip stages with valid checkpoints
- Checkpoints include `.json` metadata files with hashes
- Lock files (`.tar.gz.lock`) prevent concurrent access

### Checkpoint Validation

Checkpoints are validated using:
- File existence checks
- Hash verification (SHA-256)
- Metadata consistency checks

### Forcing Rebuild

```bash
pnpm run build --force   # Ignore all checkpoints
pnpm run clean           # Delete checkpoints before build
```

## Dev vs Prod Builds

| Aspect | Dev | Prod |
|--------|-----|------|
| Default | Local development | CI environment |
| Optimization | Faster builds | Full optimization |
| Debug symbols | Available in Release | Available in Release |
| Final binary | Same | Same |

Both modes produce identical Final binaries - the difference is in intermediate optimization levels.

## Key Paths

| Path | Description |
|------|-------------|
| `build/dev/out/Final/node/node` | Dev final binary (use for testing) |
| `build/prod/out/Final/node/node` | Prod final binary (use for release) |
| `build/dev/checkpoints/` | Dev checkpoint tarballs |
| `build/shared/source/` | Shared patched source |
| `upstream/node/` | Git submodule (nodejs/node) |
| `patches/source-patched/` | Socket Security patches |
| `additions/` | Code embedded into Node.js |

## Integration with Tests

Integration tests use the Final binary:

```javascript
import { getLatestFinalBinary } from '../paths.mjs'
const binaryPath = getLatestFinalBinary()  // build/dev/out/Final/node/node
```

## Cleaning

```bash
pnpm run clean           # Clean package checkpoints + shared checkpoints
```

The clean script handles:
- Package-specific checkpoints (`build/dev/`, `build/prod/`)
- Shared checkpoints (`build/shared/`)
- Compilation cache (`.cache/`)

## Troubleshooting

### Build uses stale code
```bash
pnpm run clean && pnpm run build
```

### Checkpoint corruption
```bash
rm -rf build/dev/checkpoints/*.tar.gz
pnpm run build
```

### Full clean rebuild
```bash
pnpm run clean
pnpm run build --force
```
