# yoga-layout-builder Build System

This document describes the build directory structure and progressive build pipeline for yoga-layout-builder.

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
packages/yoga-layout-builder/build/
├── shared/                        # Shared across dev/prod builds
│   ├── source/                    # Cloned Yoga source from upstream
│   └── checkpoints/               # source-cloned checkpoint
│
├── dev/                           # Development build workspace
│   ├── source/                    # Extracted source for dev build
│   ├── cmake/                     # CMake build artifacts
│   │   ├── yoga/libyogacore.a     # Static library
│   │   ├── yoga.wasm              # Raw WASM output
│   │   └── yoga.js                # Emscripten JS glue
│   ├── checkpoints/               # Dev checkpoints
│   │   ├── source-cloned.tar.gz   # Cloned source
│   │   ├── source-configured.tar.gz # CMake configured
│   │   ├── wasm-compiled.tar.gz   # Raw compiled WASM
│   │   ├── wasm-optimized.tar.gz  # Binaryen optimized
│   │   ├── wasm-synced.tar.gz     # Sync wrapper generated
│   │   └── finalized.tar.gz       # Final artifacts
│   │
│   └── out/                       # Build outputs
│       ├── Release/               # Raw compiled WASM
│       ├── Optimized/             # Binaryen-optimized WASM
│       ├── Sync/                  # Sync wrapper generated
│       └── Final/                 # Production-ready artifacts
│           ├── yoga.wasm          # Optimized WASM binary
│           ├── yoga.mjs           # ES module wrapper
│           └── yoga-sync.cjs      # Synchronous CJS wrapper
│
└── prod/                          # Production build workspace
    └── [same structure as dev]
```

## Build Stages

The build pipeline processes Yoga through these stages:

| Stage | Checkpoint | Output | Description |
|-------|------------|--------|-------------|
| **source-cloned** | `source-cloned.tar.gz` | `shared/source/` | Clone Yoga source from upstream |
| **source-configured** | `source-configured.tar.gz` | `{mode}/cmake/` | Configure CMake with Emscripten |
| **wasm-compiled** | `wasm-compiled.tar.gz` | `out/Release/` | Compile C++ to WASM |
| **wasm-optimized** | `wasm-optimized.tar.gz` | `out/Optimized/` | Binaryen wasm-opt optimization |
| **wasm-synced** | `wasm-synced.tar.gz` | `out/Sync/` | Generate synchronous wrapper |
| **finalized** | `finalized.tar.gz` | `out/Final/` | Production-ready WASM |

## Build Dependencies

- **Emscripten** - C++ to WASM compiler (auto-installed)
- **CMake** - Build system generator
- **Binaryen** - WASM optimization (wasm-opt)

Emscripten version is specified in `external-tools.json`.

## Dev vs Prod Builds

| Aspect | Dev | Prod |
|--------|-----|------|
| Default | Local development | CI environment |
| Optimization | -O2 (faster build) | -O3 -flto (smaller output) |
| WASM size | Larger | Smaller |
| Build time | Faster | Slower |

## Key Paths

| Path | Description |
|------|-------------|
| `build/dev/out/Final/yoga.wasm` | Dev WASM binary |
| `build/dev/out/Final/yoga.mjs` | Dev ES module |
| `build/dev/out/Final/yoga-sync.cjs` | Dev sync wrapper |
| `build/prod/out/Final/` | Prod artifacts (for release) |
| `upstream/yoga/` | Git submodule (facebook/yoga) |
| `src/yoga-wasm.cpp` | C++ bindings source |

## Output Files

### yoga.wasm
The compiled WebAssembly binary containing Yoga layout engine.

### yoga.mjs
ES module wrapper for async WASM loading:
```javascript
import { loadYoga } from './yoga.mjs'
const yoga = await loadYoga()
```

### yoga-sync.cjs
CommonJS synchronous wrapper for Node.js:
```javascript
const yoga = require('./yoga-sync.cjs')
// Ready to use immediately
```

## Cleaning

```bash
pnpm run clean           # Clean all checkpoints and artifacts
```

## Troubleshooting

### Emscripten not found
The build script auto-installs Emscripten. If issues persist:
```bash
pnpm run clean
rm -rf ~/.emscripten*
pnpm run build
```

### WASM optimization fails
```bash
pnpm run build --force   # Skip checkpoints, rebuild from scratch
```
