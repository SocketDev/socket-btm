# Node-SMOL Build System

## Overview

The node-smol-builder creates a compressed, self-extracting Node.js binary with integrated SEA (Single Executable Application) and VFS (Virtual Filesystem) support. The build system uses a checkpoint-based architecture for incremental builds.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         NODE-SMOL BUILD PIPELINE                            │
└─────────────────────────────────────────────────────────────────────────────┘

  ┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
  │  Upstream   │     │   Source    │     │   Binary    │     │   Final     │
  │  Node.js    │────►│   Packages  │────►│   Stages    │────►│   Output    │
  │  (v25.x)    │     │  + Patches  │     │  (4 stages) │     │  (~22 MB)   │
  └─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘
        │                   │                   │                   │
        ▼                   ▼                   ▼                   ▼
   source-copied      source-patched      binary-released      finalized
   checkpoint         checkpoint          → stripped →         checkpoint
                                          compressed
```

## Build Stages

### Stage Progression

```
┌────────────────────────────────────────────────────────────────────────────┐
│                           BUILD STAGE CHAIN                                 │
├────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   STAGE 0              STAGE 1              STAGE 2                        │
│   source-copied   ───► source-patched  ───► binary-released               │
│   (shared/)            (dev/ or prod/)      (out/Release/)                 │
│                                                  │                         │
│                                                  ▼                         │
│                        STAGE 5              STAGE 4              STAGE 3   │
│                        finalized       ◄─── binary-compressed ◄── binary-  │
│                        (out/Final/)         (out/Compressed/)    stripped  │
│                                                                  (out/     │
│                                                                  Stripped/)│
└────────────────────────────────────────────────────────────────────────────┘
```

### Stage Details

| Stage | Name | Input | Process | Output Size |
|-------|------|-------|---------|-------------|
| 0 | source-copied | Node.js git repo | Clone/extract upstream | ~200 MB source |
| 1 | source-patched | Pristine source | Apply 14 patches + additions | ~200 MB patched |
| 2 | binary-released | Patched source | Configure + compile | ~93 MB binary |
| 3 | binary-stripped | Release binary | Strip debug symbols | ~61 MB binary |
| 4 | binary-compressed | Stripped binary | LZFSE compression | ~22 MB binary |
| 5 | finalized | Compressed binary | Copy to Final/ | ~22 MB binary |

## Directory Structure

```
node-smol-builder/
├── additions/                        # Code embedded into Node.js
│   └── source-patched/
│       ├── lib/internal/socketsecurity/  # JavaScript runtime
│       │   ├── vfs/                      # Virtual filesystem
│       │   ├── smol/                     # SMOL bootstrap
│       │   └── polyfills/                # Locale, WebStreams
│       ├── src/socketsecurity/           # C/C++ sources (SYNCED)
│       │   ├── binject/                  # ← from packages/binject/
│       │   ├── bin-infra/                # ← from packages/bin-infra/
│       │   ├── build-infra/              # ← from packages/build-infra/
│       │   ├── sea-smol/                 # SEA/SMOL integration
│       │   └── vfs/                      # VFS C++ binding
│       └── deps/                         # Compression libraries
│           ├── libdeflate/               # ← from binject/upstream/
│           ├── lzfse/                    # ← from lief-builder/upstream/
│           └── fast-webstreams/          # Vercel's fast streams
│
├── patches/
│   └── source-patched/               # 14 Node.js patches
│       ├── 001-common_gypi_fixes.patch
│       ├── 002-polyfills.patch
│       ├── ...
│       └── 014-fast-webstreams.patch
│
├── scripts/
│   ├── common/shared/
│   │   └── build.mjs                 # Main build orchestrator
│   ├── binary-released/shared/
│   │   ├── build-released.mjs        # Clone, patch, compile
│   │   ├── prepare-external-sources.mjs  # Sync source packages
│   │   └── copy-additions.mjs        # Copy additions to Node.js
│   ├── source-patched/shared/
│   │   └── apply-patches.mjs         # Apply 14 patches
│   ├── binary-stripped/shared/
│   │   └── build-stripped.mjs        # Strip debug symbols
│   ├── binary-compressed/shared/
│   │   └── build-compressed.mjs      # LZFSE compression
│   └── finalized/shared/
│       └── finalize-binary.mjs       # Copy to Final/
│
├── build/
│   ├── shared/                       # Shared artifacts
│   │   ├── source/                   # Pristine Node.js source
│   │   └── checkpoints/
│   │       └── source-copied.json
│   │
│   ├── dev/                          # Development build
│   │   ├── source/                   # Patched source tree
│   │   ├── out/
│   │   │   ├── Release/node/node     # Full binary (93 MB)
│   │   │   ├── Stripped/node/node    # Stripped (61 MB)
│   │   │   ├── Compressed/node/node  # Compressed (22 MB)
│   │   │   └── Final/node/node       # Distribution ready
│   │   ├── checkpoints/
│   │   │   ├── source-patched.json
│   │   │   ├── binary-released.json
│   │   │   ├── binary-stripped.json
│   │   │   ├── binary-compressed.json
│   │   │   └── finalized.json
│   │   └── .cache/
│   │       └── cache-validation.hash
│   │
│   └── prod/                         # Production build (same structure)
│
└── upstream/
    └── node/                         # Node.js git submodule
```

## Source Package Integration

### Source of Truth Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    SOURCE PACKAGE FLOW (Source of Truth)                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  CANONICAL SOURCES                      SYNCED TO ADDITIONS                 │
│  (edit these)                           (gitignored, generated)             │
│                                                                             │
│  packages/binject/src/                                                      │
│  └── socketsecurity/binject/  ────────► additions/source-patched/          │
│      ├── binject.c                      └── src/socketsecurity/binject/    │
│      ├── binject.h                                                          │
│      ├── macho_inject_lief.cpp                                             │
│      └── ...                                                                │
│                                                                             │
│  packages/bin-infra/src/                                                    │
│  └── socketsecurity/bin-infra/ ───────► additions/source-patched/          │
│      ├── segment_names.h                └── src/socketsecurity/bin-infra/  │
│      ├── stub_smol_repack_lief.cpp                                         │
│      └── ...                                                                │
│                                                                             │
│  packages/build-infra/src/                                                  │
│  └── socketsecurity/build-infra/ ─────► additions/source-patched/          │
│      ├── file_utils.c                   └── src/socketsecurity/build-infra/│
│      ├── tar.c                                                              │
│      └── ...                                                                │
│                                                                             │
│  packages/lief-builder/upstream/lzfse/ ───────► additions/deps/lzfse/      │
│  packages/binject/upstream/libdeflate/ ───────► additions/deps/libdeflate/ │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Sync Process

The `prepare-external-sources.mjs` script handles synchronization:

1. Copies source files from canonical packages to additions/
2. Validates sync via SHA256 directory content hashing
3. Runs during binary-released phase initialization

**Never edit additions/ directly** - changes will be overwritten on next sync.

## Patch System

### Patch Categories

| Category | Patches | Purpose |
|----------|---------|---------|
| Build System | 001, 004, 009 | Compiler flags, source file integration |
| Bootstrap | 002, 003, 005, 010 | Runtime initialization, binding registration |
| SEA Integration | 006, 007, 008, 013 | Single Executable Application support |
| VFS Support | 010, 011 | Virtual filesystem module resolution |
| Performance | 014 | Fast WebStreams polyfill |
| Debug | 012 | Debug category registration |

### Patch Application Order

```
001-common_gypi_fixes.patch      # Compiler/linker optimization
002-polyfills.patch              # Locale polyfills for small-icu
003-realm-vfs-binding.patch      # Register smol_vfs binding
004-node-gyp-vfs-binject.patch   # Add ~55 source files to build
005-node-binding-vfs.patch       # Replace WASI with smol_vfs
006-node-sea-smol-config.patch   # SEA configuration parsing
007-node-sea-header.patch        # SEA struct definitions
008-node-sea-bin-binject.patch   # Replace LIEF with binject
009-fix_v8_typeindex_macos.patch # macOS V8 compilation fix
010-vfs_bootstrap.patch          # VFS initialization at startup
011-vfs_require_resolve.patch    # Module resolution hooks
012-debug-utils-smol-sea-category.patch  # Debug utilities
013-node-sea-silent-exit.patch   # SEA exit handling
014-fast-webstreams.patch        # 10x faster WebStreams
```

## Checkpoint System

### Checkpoint Validation

Each checkpoint stores metadata for cache validation:

```json
{
  "created": "2026-03-07T16:22:21.820Z",
  "name": "binary-released",
  "artifactPath": "/path/to/build/dev/out/Release/node",
  "platform": "darwin",
  "arch": "arm64",
  "binarySize": "93.45 MB",
  "artifactHash": "62a05b5deae739698a26ebe4a52b8941...",
  "sourcePaths": [
    "packages/binject/src/socketsecurity/binject/binject.c",
    ...
  ]
}
```

### Cache Invalidation Rules

| Change Type | Invalidates |
|-------------|-------------|
| Patch file modified | source-patched → all downstream |
| Source package modified | binary-released → all downstream |
| Build script modified | Affected phase → all downstream |
| `--clean` flag | All checkpoints |

### Incremental Build Commands

```bash
# Full build (uses checkpoints)
pnpm run build

# Skip to specific phase
pnpm run build --from-checkpoint=binary-stripped

# Stop at specific phase
pnpm run build --stop-at=binary-stripped

# Force clean rebuild
pnpm run build --clean

# Production build
pnpm run build --prod
```

## Compression Architecture

### Why LZFSE Instead of UPX

| Feature | UPX | LZFSE |
|---------|-----|-------|
| Compression ratio | 50-60% | 75-79% |
| macOS code signing | Broken | Preserved |
| AV false positives | 15-30% | 0% |
| Self-modifying code | Yes | No |

### Compressed Binary Format

```
Offset  Size    Description
──────────────────────────────────────────────────────────────
0       32      Magic: "__SMOL_PRESSED_DATA_MAGIC_MARKER"
32      8       Compressed size (uint64_t, little-endian)
40      8       Uncompressed size (uint64_t, little-endian)
48      16      Cache key (hex string, SHA256 of original)
64      1       Platform: 0=linux, 1=darwin, 2=win32
65      1       Arch: 0=x64, 1=arm64, 2=ia32, 3=arm
66      1       Libc: 0=glibc, 1=musl, 255=n/a
67      1       SMOL config flag: 0=no, 1=yes
68      1192    [Optional] SMOL config (if flag=1)
1260+   var     LZFSE compressed data
```

### Size Reduction Pipeline

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           SIZE REDUCTION FLOW                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   93 MB   Release binary (full compilation)                                 │
│     │                                                                       │
│     ▼     strip debug symbols                                              │
│   61 MB   Stripped binary (-34%)                                           │
│     │                                                                       │
│     ▼     LZFSE compression (75-79% ratio)                                 │
│   22 MB   Compressed binary (-64% from stripped)                           │
│     │                                                                       │
│     ▼     Self-extracting wrapper added                                    │
│   22 MB   Final distribution binary (-76% from release)                    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Build Modes

### Development vs Production

| Setting | Dev Mode | Prod Mode |
|---------|----------|-----------|
| LTO | Disabled | ThinLTO enabled |
| Debug symbols | Enabled | Stripped |
| V8 Lite | Disabled | Disabled (full JIT) |
| Inspector | Enabled | Enabled |
| Build time | ~15 min | ~30 min |
| Final size | ~22 MB | ~22 MB |

### Build Mode Selection

```bash
# Local development (default)
pnpm run build              # Uses dev mode

# Production build
pnpm run build --prod       # Uses prod mode

# CI automatically uses prod mode
CI=true pnpm run build      # Uses prod mode
```

## Key Build Scripts

| Script | Location | Purpose |
|--------|----------|---------|
| `build.mjs` | `scripts/common/shared/` | Main orchestrator |
| `build-released.mjs` | `scripts/binary-released/shared/` | Clone, patch, compile |
| `prepare-external-sources.mjs` | `scripts/binary-released/shared/` | Sync source packages |
| `copy-additions.mjs` | `scripts/binary-released/shared/` | Copy additions to Node.js |
| `apply-patches.mjs` | `scripts/source-patched/shared/` | Apply 14 patches |
| `build-stripped.mjs` | `scripts/binary-stripped/shared/` | Strip debug symbols |
| `build-compressed.mjs` | `scripts/binary-compressed/shared/` | LZFSE compression |
| `finalize-binary.mjs` | `scripts/finalized/shared/` | Copy to Final/ |
| `clean.mjs` | `scripts/` | Delete build directory |

## Test Binary Selection

For integration and E2E tests, always use the Final binary:

```javascript
import { getLatestFinalBinary } from '../paths.mjs'

const binaryPath = getLatestFinalBinary()
```

**Do NOT use intermediate stages** (Compressed, Stripped, Release) for tests - these are build artifacts, not the production binary.
