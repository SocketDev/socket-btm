# onnxruntime-builder Build System

This document describes the build directory structure and progressive build pipeline for onnxruntime-builder.

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
packages/onnxruntime-builder/build/
├── shared/                        # Shared across dev/prod builds
│   ├── source/                    # Cloned ONNX Runtime source
│   │   ├── cmake/                 # CMake configuration
│   │   ├── build.sh               # Official build script
│   │   └── js/web/script/         # Post-build scripts
│   └── checkpoints/               # source-cloned checkpoint
│
├── dev/                           # Development build workspace
│   ├── source/                    # Extracted source for dev build
│   │   └── build/                 # CMake build output
│   │       └── {MacOS|Linux}/     # Platform-specific
│   │           └── Release/       # Build artifacts
│   │               ├── ort-wasm-simd-threaded.wasm
│   │               └── ort-wasm-simd-threaded.mjs
│   ├── checkpoints/               # Dev checkpoints
│   │   ├── source-cloned.tar.gz
│   │   ├── wasm-compiled.tar.gz
│   │   ├── wasm-optimized.tar.gz
│   │   ├── wasm-synced.tar.gz
│   │   └── finalized.tar.gz
│   │
│   └── out/                       # Build outputs
│       ├── Release/               # Raw compiled WASM
│       ├── Optimized/             # Binaryen optimized
│       ├── Sync/                  # Sync wrapper generated
│       └── Final/                 # Production-ready artifacts
│           ├── ort.wasm           # Optimized WASM binary
│           ├── ort.mjs            # ES module wrapper
│           └── ort-sync.cjs       # Synchronous CJS wrapper
│
└── prod/                          # Production build workspace
    └── [same structure as dev]
```

## Build Stages

The build pipeline processes ONNX Runtime through these stages:

| Stage | Checkpoint | Output | Description |
|-------|------------|--------|-------------|
| **source-cloned** | `source-cloned.tar.gz` | `shared/source/` | Clone ONNX Runtime + dependencies |
| **wasm-compiled** | `wasm-compiled.tar.gz` | `out/Release/` | Compile C++ to WASM (long) |
| **wasm-optimized** | `wasm-optimized.tar.gz` | `out/Optimized/` | Binaryen wasm-opt optimization |
| **wasm-synced** | `wasm-synced.tar.gz` | `out/Sync/` | Generate synchronous wrapper |
| **finalized** | `finalized.tar.gz` | `out/Final/` | Production-ready WASM |

## Platform-Specific Build Paths

ONNX Runtime's CMake creates platform-specific directories:

| Platform | Build Path |
|----------|------------|
| macOS | `source/build/MacOS/Release/` |
| Linux | `source/build/Linux/Release/` |

This is the official ONNX Runtime build structure.

## Build Dependencies

- **Emscripten** - C++ to WASM compiler (auto-installed)
- **CMake** - Build system generator
- **Binaryen** - WASM optimization
- **Python** - Required by ONNX Runtime build

Emscripten and Eigen versions are specified in `external-tools.json` and `package.json`.

## Dev vs Prod Builds

| Aspect | Dev | Prod |
|--------|-----|------|
| Default | Local development | CI environment |
| Optimization | Faster build | Full optimization |
| Threading | SIMD + threads | SIMD + threads |
| Build time | ~20 min | ~30 min |

## Key Paths

| Path | Description |
|------|-------------|
| `build/dev/out/Final/ort.wasm` | Dev WASM binary |
| `build/dev/out/Final/ort.mjs` | Dev ES module |
| `build/dev/out/Final/ort-sync.cjs` | Dev sync wrapper |
| `build/prod/out/Final/` | Prod artifacts (for release) |
| `upstream/onnxruntime/` | Git submodule (microsoft/onnxruntime) |

## Output Files

### ort.wasm
The compiled WebAssembly binary containing ONNX Runtime inference engine with SIMD and threading support.

### ort.mjs
ES module wrapper for async WASM loading:
```javascript
import { loadOrt } from './ort.mjs'
const ort = await loadOrt()
```

### ort-sync.cjs
CommonJS synchronous wrapper for Node.js:
```javascript
const ort = require('./ort-sync.cjs')
```

## Build Time

ONNX Runtime is a large project. Expected build times:

| Stage | Time |
|-------|------|
| source-cloned | 5-10 min |
| wasm-compiled | 15-25 min |
| wasm-optimized | 2-5 min |
| Total | 20-40 min |

Checkpoints significantly speed up subsequent builds.

## Cleaning

```bash
pnpm run clean           # Clean all checkpoints and artifacts
```

## Troubleshooting

### Build runs out of memory
ONNX Runtime compilation is memory-intensive. Ensure at least 8GB RAM available.

### Emscripten version mismatch
```bash
pnpm run clean
rm -rf ~/.emscripten*
pnpm run build
```

### Eigen download fails
Check network connectivity. Eigen is downloaded during source cloning.
