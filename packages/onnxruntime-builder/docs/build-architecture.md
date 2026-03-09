# Build Architecture

Architecture documentation for the ONNX Runtime WASM builder.

## Overview

onnxruntime-builder compiles ONNX Runtime to WebAssembly with:
- Threading support (SharedArrayBuffer)
- SIMD optimization
- Synchronous loading wrapper

## Build Phases

```
┌─────────────────────────────────────────────────────────────────┐
│                    BUILD PIPELINE                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Phase 0: Clone Source                                          │
│    • Clone ONNX Runtime repo                                     │
│    • Verify commit SHA                                           │
│    • Apply patches                                               │
│    ↓                                                             │
│  Phase 1: Compile WASM                                          │
│    • Configure Emscripten                                        │
│    • Run build with cmake/ninja                                  │
│    • Generate ort.wasm + ort.mjs                                │
│    ↓                                                             │
│  Phase 2: Release Copy                                          │
│    • Copy artifacts from build dir                               │
│    • Validate WASM magic                                         │
│    ↓                                                             │
│  Phase 3: Optimize (prod only)                                  │
│    • Run wasm-opt -Oz                                            │
│    • Enable threads + SIMD                                       │
│    ↓                                                             │
│  Phase 4: Generate Sync                                         │
│    • Transform async → sync                                      │
│    • Embed WASM as base64                                        │
│    • Generate ort-sync.cjs + ort-sync.mjs                       │
│    ↓                                                             │
│  Phase 5: Finalize                                              │
│    • Copy to Final directory                                     │
│    • Run smoke tests                                             │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Phase Details

### Phase 0: Clone Source

Clones ONNX Runtime repository with patches.

**Configuration (package.json):**
```json
{
  "sources": {
    "onnxruntime": {
      "version": "1.20.1",
      "type": "git",
      "url": "https://github.com/microsoft/onnxruntime.git",
      "ref": "5c1b7ccbff7e5141c1da7a9d963d660e5741c319"
    }
  }
}
```

**Patches Applied:**
1. Eigen SHA1 hash fix (GitLab archive regeneration)
2. MLFloat16 build fix (threading compatibility)
3. Post-build script modifications

**Verification:**
- Git SHA matches expected ref
- Patch markers present in source

### Phase 1: Compile WASM

Compiles C++ to WebAssembly using Emscripten.

**Build Flags:**
```bash
./build.sh \
  --build_wasm_static_lib \
  --enable_wasm_threads \
  --enable_wasm_simd \
  --disable_rtti \
  --parallel \
  --minimal_build extended \
  --skip_tests \
  --allow_running_as_root
```

**Flag Purposes:**

| Flag | Purpose |
|------|---------|
| `--enable_wasm_threads` | Enable SharedArrayBuffer threading |
| `--enable_wasm_simd` | Enable WASM SIMD instructions |
| `--disable_rtti` | Reduce binary size |
| `--minimal_build extended` | Include only essential operators |
| `--skip_tests` | Skip test compilation |

**Parallelization:**
- CI: 100% CPU cores
- Local: 75% CPU cores

**Tools:**
- Ninja (faster than Make)
- ccache (incremental compilation)

### Phase 2: Release Copy

Copies build artifacts to Release directory.

**Artifacts:**
```
Release/
├── ort.wasm         # WASM binary
└── ort.mjs          # Emscripten loader
```

**Validation:**
- WASM magic number (0x0061736d)
- File size within expected range

### Phase 3: Optimize (Production)

Runs wasm-opt for size optimization.

```bash
wasm-opt -Oz \
  --enable-threads \
  --enable-simd \
  -o ort.wasm \
  ort.wasm
```

**Size Impact:**
| Mode | Size |
|------|------|
| Dev | ~9.4 MB |
| Prod (optimized) | ~4.7 MB |

### Phase 4: Generate Sync

Transforms async WASM loading to synchronous.

**Process:**
1. Read ort.mjs (async ES6 module)
2. Remove async/await keywords
3. Replace WebAssembly.instantiate with sync version
4. Embed WASM as base64 string
5. Generate CommonJS and ESM wrappers

**Output:**
```
Sync/
├── ort-sync.cjs     # CommonJS with embedded WASM
└── ort-sync.mjs     # ESM with embedded WASM
```

**Size:**
- ~13-14 MB each (WASM base64 + loader)

### Phase 5: Finalize

Copies to Final directory and runs smoke tests.

**Tests:**
- File exists and non-empty
- Module loads with `require()`
- Module is NOT a Promise
- Export count matches expected

## Checkpoint System

Each phase creates a checkpoint for incremental builds.

```
build/dev/checkpoints/
├── clone-source.json
├── compile-wasm.json
├── copy-release.json
├── optimize-wasm.json    # prod only
├── generate-sync.json
└── finalize.json
```

**Checkpoint Contents:**
- Timestamp
- Input file hashes
- Output file paths
- Build mode (dev/prod)

**Skip Logic:**
If checkpoint exists and inputs unchanged, phase is skipped.

## Source Patches

### Patch 1: Eigen SHA1

**Problem:** GitLab regenerates archives with different SHA1 hashes.

**Location:** `cmake/deps.txt`

**Fix:** Update expected SHA1 to match current archive.

### Patch 2: MLFloat16 Build

**Problem:** MLFloat16 operators fail to build with threading enabled.

**Location:** `cmake/onnxruntime_webassembly.cmake`

**Fix:** Comment out conflicting BUILD_MLAS_NO_ONNXRUNTIME definition.

### Patch 3: Post-Build Script

**Location:** `js/web/script/wasm_post_build.js`

**Fix:** Custom module export handling for sync wrapper compatibility.

## Output Files

### Final Output Structure

```
build/<mode>/out/Final/
├── ort.wasm           # Raw WASM binary
├── ort.mjs            # Original async ES6 loader
├── ort-sync.cjs       # Sync CommonJS wrapper
└── ort-sync.mjs       # Sync ESM wrapper
```

### File Purposes

| File | Use Case |
|------|----------|
| ort.wasm | Async loading with fetch() |
| ort.mjs | Browser ESM async usage |
| ort-sync.cjs | Node.js CommonJS sync require() |
| ort-sync.mjs | Node.js ESM sync import |

## Build Requirements

### System Requirements

- 5 GB free disk space
- 8 GB RAM recommended
- Multi-core CPU (build is parallelized)

### Tools

| Tool | Required | Purpose |
|------|----------|---------|
| Emscripten | Yes | C++ to WASM compiler |
| CMake | Yes | Build configuration |
| Ninja | Recommended | Fast build system |
| ccache | Recommended | Compilation caching |
| wasm-opt | Prod only | WASM optimization |

### Tool Versions

From `external-tools.json`:
```json
{
  "emsdk": "4.0.20"
}
```

## Build Commands

### Development Build

```bash
pnpm run build
```

- Skips wasm-opt optimization
- Larger output (~9.4 MB)
- Faster build time

### Production Build

```bash
pnpm run build --prod
```

- Includes wasm-opt optimization
- Smaller output (~4.7 MB)
- Longer build time

### Clean Build

```bash
pnpm run clean
pnpm run build
```

### Resume from Checkpoint

```bash
pnpm run build --from-checkpoint=compile-wasm
```

## Docker Build

For reproducible builds:

```bash
docker build -f Dockerfile.linux -t onnxruntime-builder .
docker run --rm -v $(pwd)/build:/build onnxruntime-builder
```

## Troubleshooting

### "Emscripten not found"

```bash
# Install emsdk
git clone https://github.com/emscripten-core/emsdk.git
cd emsdk
./emsdk install 4.0.20
./emsdk activate 4.0.20
source ./emsdk_env.sh
```

### "CMake version too old"

Requires CMake 3.26+ but < 3.30 (google_nsync compatibility).

### Build timeout

Increase parallelization or add swap space:
```bash
export JOBS=4
```

### Patch failed to apply

Source version may have changed. Regenerate patches from current source.

## Related Documentation

- [WASM Sync Transforms](../../build-infra/docs/wasm-sync-transforms.md) - Transform details
- [Caching Strategy](../../build-infra/docs/caching-strategy.md) - Checkpoint system
