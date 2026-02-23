# Socket BTM Architecture

**Date**: 2026-02-14
**Version**: 1.0

Build infrastructure for Socket's binary artifacts and ML models.

---

## Table of Contents

1. [Overview](#overview)
2. [Package Categories](#package-categories)
3. [Dependency Graph](#dependency-graph)
4. [Build System Architecture](#build-system-architecture)
5. [Testing Architecture](#testing-architecture)
6. [Checkpoint System](#checkpoint-system)
7. [Cross-Platform Support](#cross-platform-support)
8. [CI/CD Architecture](#cicd-architecture)
9. [Common Patterns](#common-patterns)
10. [Development Workflow](#development-workflow)

---

## Overview

Socket BTM is a pnpm monorepo containing 12 packages organized into infrastructure, binary tools, Node.js builders, WASM builders, and ML model builders.

### Design Principles

1. **Progressive Build System** - Use checkpoints to cache intermediate artifacts
2. **Cross-Platform** - Support macOS, Linux (glibc/musl), Windows
3. **Reproducible Builds** - Pinned versions, deterministic outputs
4. **Minimal Dependencies** - Build from source where possible
5. **Source of Truth** - Infrastructure packages are canonical, additions sync FROM them

### Technology Stack

- **Languages**: JavaScript/TypeScript (Node.js 25), C/C++, Python (build scripts)
- **Build Systems**: CMake, Make, Emscripten, gyp
- **Package Manager**: pnpm (workspaces + catalog)
- **Testing**: Vitest (unit/integration), custom test harnesses
- **CI/CD**: GitHub Actions, checkpoint caching

---

## Package Categories

### 1. Infrastructure Packages (3)

Core infrastructure shared across all packages.

| Package | Purpose | Exports | Dependencies |
|---------|---------|---------|--------------|
| **build-infra** | Build system core (checkpoints, CMake, WASM) | 42 modules | @socketsecurity/lib, acorn, magic-string |
| **bin-infra** | Binary manipulation (LIEF, compression, formats) | 3 modules | build-infra, @socketsecurity/lib |
| **bin-stubs** | Self-extracting stub binaries | Platform stubs | bin-infra, build-infra |

**Key Features**:
- Checkpoint system for incremental builds
- Cross-platform build helpers
- Tool installation and verification
- External dependency management

### 2. Binary Tools (3)

C/C++ tools for binary manipulation.

| Package | Purpose | Output | Dependencies |
|---------|---------|--------|--------------|
| **binject** | Inject SEA/VFS into binaries (Mach-O, ELF, PE) | `binject` binary | bin-infra, LIEF |
| **binpress** | Compress binaries with LZFSE | `binpress` binary | bin-infra, LIEF, stubs |
| **binflate** | Decompress binaries (CLI tool) | `binflate` binary | build-infra |

**Build Pattern**: Makefile-wrapped (platform-specific Makefiles)

**Dependencies**:
- **LIEF** (v0.17.0) - Binary manipulation library
- **LZFSE** - Apple compression (macOS native, submodule on Linux/Windows)
- **curl + mbedTLS** - HTTPS update checking (bin-stubs)

### 3. Node.js Builder (1)

Custom Node.js build with Socket security patches.

| Package | Purpose | Output | Patches |
|---------|---------|--------|---------|
| **node-smol-builder** | Node.js v25 + Socket patches | Custom node binary | 15 source patches |

**Key Features**:
- SEA (Single Executable Application) support
- VFS (Virtual File System) injection
- Security hardening patches
- Optimized binary size (~50-70% smaller with compression)

### 4. WASM Builders (2)

WebAssembly module builders with sync wrappers.

| Package | Purpose | Output | Source |
|---------|---------|--------|--------|
| **onnxruntime-builder** | ONNX Runtime WASM | `ort.wasm` + sync wrapper | Microsoft ONNX Runtime 1.20.1 |
| **yoga-layout-builder** | Yoga Layout WASM | `yoga.wasm` + sync wrapper | Facebook Yoga 3.1.0 |

**Build Pattern**: Emscripten + sync wrapper generation

**Sync Wrappers**:
- Convert async WASM to synchronous API
- Generated during build from async module
- Provides both ESM (`.mjs`) and CJS (`.cjs`) outputs

### 5. ML Model Builders (3)

Machine learning model quantization and distribution.

| Package | Purpose | Output | Quantization |
|---------|---------|--------|--------------|
| **codet5-models-builder** | CodeT5 encoder/decoder | INT8 (dev), INT4 (prod) | Salesforce/codet5-base |
| **minilm-builder** | MiniLM-L6-v2 embeddings | INT8 (dev), INT4 (prod) | sentence-transformers |
| **models** | ML model distribution | Exports quantized models | Depends on builders |

**Build Pattern**: Python-based (ONNX, optimum, quantization)

**Model Pipeline**:
1. Download from HuggingFace
2. Convert PyTorch → ONNX
3. Optimize graph
4. Quantize (INT8 dev, INT4 prod)
5. Package with tokenizer

---

## Dependency Graph

### Build Dependencies

```
build-infra (core infrastructure)
  ↓
bin-infra (binary infrastructure)
  ↓
├─→ bin-stubs → binpress → node-smol-builder
├─→ binject → node-smol-builder
├─→ binflate (standalone)
│
models
  ↓
codet5-models-builder + minilm-builder

onnxruntime-builder (independent)
yoga-layout-builder (independent)
```

### Runtime Dependencies

**node-smol-builder runtime flow**:
```
1. Build node-smol → node binary
2. Inject SEA + VFS → binject → injected node
3. Compress → binpress → compressed node
4. Self-extracting → bin-stubs embedded in compressed node
```

**User executes compressed node**:
```
1. Stub detects execution
2. Generates cache key
3. Decompresses to ~/.socket/_dlx/<key>/
4. Executes decompressed binary
```

### Workspace Dependencies

All packages use `workspace:*` protocol for internal dependencies:
```json
{
  "dependencies": {
    "build-infra": "workspace:*",
    "bin-infra": "workspace:*"
  }
}
```

---

## Build System Architecture

### Build Modes

Two build modes control optimization and output size:

| Mode | Environment | Optimization | Size | Use Case |
|------|-------------|--------------|------|----------|
| **dev** | `BUILD_MODE=dev` | Debug, INT8 quant | Larger | Local development |
| **prod** | `BUILD_MODE=prod` | Release, INT4 quant | Smaller | Production/CI |

### Build Output Structure

Standard build output location across all packages:
```
packages/{package}/
├── build/
│   ├── dev/
│   │   ├── checkpoints/           # Incremental build artifacts
│   │   ├── out/
│   │   │   ├── Compiled/          # Post-compilation
│   │   │   ├── Stripped/          # Symbol-stripped
│   │   │   ├── Compressed/        # LZFSE compressed
│   │   │   └── Final/             # Production-ready output ⭐
│   ├── prod/
│   │   └── out/Final/             # Production builds
│   └── shared/                     # Mode-independent artifacts
```

**Final Stage**: The `Final/` directory contains production-ready artifacts:
- Binaries (potentially compressed)
- WASM modules with sync wrappers
- Quantized ML models with tokenizers

### Checkpoint System

Progressive build system that caches intermediate artifacts.

#### Checkpoint Structure

```
build/{mode}/checkpoints/
├── {checkpoint-name}.{platform}-{arch}-{libc}.tar.gz
└── {checkpoint-name}.{platform}-{arch}-{libc}.metadata.json
```

**Metadata**:
```json
{
  "name": "source-copied",
  "platform": "darwin-arm64",
  "createdAt": "2025-01-15T10:30:00Z",
  "cacheKey": "abc123...",
  "buildMode": "dev"
}
```

#### Checkpoint Stages

Common checkpoint names across packages:
- `source-copied` - Initial source copy
- `dependencies-built` - External deps (LIEF, curl, etc.)
- `compiled` - Post-compilation
- `stripped` - Symbol stripping complete
- `compressed` - Compression applied
- `finalized` - Ready for distribution

#### Checkpoint Operations

```javascript
import { createCheckpoint, hasCheckpoint, shouldRun } from 'build-infra/lib/checkpoint-manager'

// Check if checkpoint exists
if (await hasCheckpoint({ packageDir, name: 'compiled' })) {
  console.log('Using cached compilation')
} else {
  // Build from scratch
  await compile()
  await createCheckpoint({ packageDir, name: 'compiled', sourceDir: 'out/Compiled' })
}

// Determine if stage should run
if (await shouldRun({ packageDir, name: 'compiled', force })) {
  await compile()
}
```

### Build Scripts

Standard script structure:
```
packages/{package}/
├── scripts/
│   ├── build.mjs              # Main build orchestration
│   ├── clean.mjs              # Clean build artifacts + checkpoints
│   ├── test.mjs               # Test runner (C packages)
│   ├── check-tools.mjs        # Verify external dependencies
│   └── paths.mjs              # Centralized path management
```

### External Tools

Packages document external dependencies in `external-tools.json`:
```json
{
  "$schema": "../build-infra/lib/external-tools-schema.json",
  "description": "External tools required for building",
  "tools": {
    "cmake": {
      "description": "CMake build system generator",
      "packages": {
        "darwin": { "brew": "cmake" },
        "linux": { "apt": "cmake", "dnf": "cmake" },
        "win32": { "manual": "Pre-installed on GitHub Actions" }
      },
      "versions": {
        "darwin": "3.28+",
        "linux": "3.28+",
        "win32": "Pre-installed"
      }
    }
  }
}
```

---

## Testing Architecture

Three testing patterns based on package type. See [docs/testing-patterns.md](docs/testing-patterns.md) for details.

### Pattern 1: Standard Vitest (9 packages)

Pure JavaScript/TypeScript packages use standard vitest:

```json
{
  "scripts": {
    "test": "vitest run",
    "coverage": "vitest run --coverage"
  }
}
```

**Packages**: bin-infra, bin-stubs, build-infra, codet5-models-builder, minilm-builder, models, node-smol-builder, onnxruntime-builder, yoga-layout-builder

### Pattern 2: Environment-Aware Vitest (1 package)

Tests requiring environment variables:

```json
{
  "scripts": {
    "test": "dotenvx run --env-file=.env.test -- vitest run"
  }
}
```

**Package**: binject

### Pattern 3: Makefile-Wrapped Tests (2 packages)

C/C++ packages with native dependencies:

```json
{
  "scripts": {
    "test": "dotenvx run --env-file=.env.test -- node scripts/test.mjs"
  }
}
```

**Packages**: binflate, binpress

**Test Flow**:
1. Check external tools (cmake, ninja, compilers)
2. Ensure dependencies (LIEF, curl, lzfse)
3. Check for existing binary (checkpoint restoration)
4. Build if needed via `make -f Makefile.{platform} all`
5. Run tests via `make -f Makefile.{platform} test`
6. Graceful skip in CI if dependencies unavailable

### Coverage

All JavaScript/TypeScript packages support code coverage:

```bash
pnpm run coverage  # Generate coverage report
```

**Configuration** (`vitest.config.mts`):
- Provider: v8
- Reporters: text, html, json-summary
- Exclusions: node_modules, build, dist, test, scripts

---

## Checkpoint System

### Cache Key Generation

Checkpoints use content-based cache keys for invalidation:

```javascript
import { generateCacheKey } from 'build-infra/lib/cache-key'

const cacheKey = await generateCacheKey({
  packageDir,
  inputs: [
    'src/**/*.c',
    'src/**/*.h',
    'Makefile.*'
  ],
  version: '1.0.0'
})
```

### Checkpoint Restoration

CI automatically restores checkpoints from cache:

```yaml
- name: Restore Build Checkpoints
  uses: actions/cache@v4
  with:
    path: |
      packages/*/build/*/checkpoints/
    key: checkpoint-${{ runner.os }}-${{ hashFiles('...') }}
```

### Cache Invalidation

Cache versions in `.github/cache-versions.json` control invalidation:

```json
{
  "stubs": "v25",
  "binflate": "v56",
  "binject": "v76",
  "binpress": "v76",
  "node-smol": "v64"
}
```

**Cascade Rule**: When modifying shared source files, bump cache versions for all dependent packages. See `CLAUDE.md` for cascade dependency chart.

---

## Cross-Platform Support

### Supported Platforms

| Platform | Arch | C Variant | Status |
|----------|------|-----------|--------|
| macOS | x64, arm64 | N/A | ✅ Primary |
| Linux | x64, arm64 | glibc | ✅ Primary |
| Linux | x64, arm64 | musl | ✅ Secondary |
| Windows | x64 | N/A | ✅ Secondary |

### Platform Detection

```javascript
import { getAssetPlatformArch, detectLibc } from 'build-infra/lib/platform-mappings'

const platform = process.platform  // darwin, linux, win32
const arch = process.arch          // x64, arm64
const libc = detectLibc()          // glibc, musl (Linux only)

const platformArch = getAssetPlatformArch(platform, arch, libc)
// Examples: darwin-arm64, linux-x64-glibc, linux-x64-musl, win-x64
```

### Platform-Specific Makefiles

C packages use separate Makefiles per platform:

```
Makefile.macos    # macOS (Clang + Compression framework)
Makefile.linux    # Linux (GCC + lzfse from submodule)
Makefile.windows  # Windows (MinGW via MSYS2 + lzfse)
```

**Selection**:
```javascript
function selectMakefile() {
  if (process.platform === 'linux') return 'Makefile.linux'
  if (process.platform === 'win32') return 'Makefile.windows'
  return 'Makefile.macos'
}
```

### Cross-Compilation

Set `TARGET_ARCH` for cross-compilation:

```bash
TARGET_ARCH=arm64 pnpm run build  # Build ARM64 on x64 host
TARGET_ARCH=x64 pnpm run build    # Build x64 on ARM64 host
```

---

## CI/CD Architecture

### GitHub Actions Workflow

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    strategy:
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
        node: [25]

    steps:
      - uses: actions/checkout@v4
        with:
          submodules: recursive  # Clone LIEF, curl, lzfse submodules

      - uses: pnpm/action-setup@v4

      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node }}
          cache: 'pnpm'

      - name: Restore Checkpoints
        uses: actions/cache@v4
        with:
          path: packages/*/build/*/checkpoints/
          key: checkpoint-${{ runner.os }}-${{ hashFiles('...') }}

      - run: pnpm install
      - run: pnpm test
```

### Graceful Test Skipping

C packages gracefully skip tests in CI when build tools unavailable:

```javascript
if (process.env.CI) {
  logger.warn('Build failed in CI environment (missing system dependencies)')
  logger.success('Tests skipped (dependencies not available)')
  process.exitCode = 0  // Not process.exit(0)!
  return
}
```

### CI Optimization

1. **Checkpoint Caching** - Restore intermediate build artifacts
2. **Parallel Jobs** - Matrix builds across OS/Node versions
3. **Selective Testing** - Only run tests for changed packages
4. **Graceful Skips** - Skip tests when dependencies unavailable

---

## Common Patterns

### Source of Truth Pattern

Infrastructure packages are canonical sources:

```
Source Packages (canonical):
├── binject/src/socketsecurity/binject/
├── bin-infra/src/socketsecurity/bin-infra/
└── build-infra/src/socketsecurity/build-infra/

Synced To (gitignored):
└── node-smol-builder/additions/source-patched/src/socketsecurity/
    ├── binject/      (copied from binject/src/)
    ├── bin-infra/    (copied from bin-infra/src/)
    └── build-infra/  (copied from build-infra/src/)
```

**Rule**: ALL work happens in source packages. Additions sync FROM sources, never TO sources.

### Package Selection Rules

- **build-infra**: Code used by (binject, binpress, OR binflate) AND node-smol
- **bin-infra**: Code used ONLY by binject, binpress, OR binflate (not node-smol)

Example: Segment names used by node-smol tests → `build-infra/test-helpers/`

### Error Handling

```javascript
// Use process.exitCode, not process.exit()
if (error) {
  logger.fail(`Build failed: ${error.message}`)
  process.exitCode = 1  // Allows cleanup handlers to run
  return
}

// Never use process.exit(0) except in truly exceptional cases
```

### Logging

All packages use `@socketsecurity/lib/logger`:

```javascript
import { getDefaultLogger } from '@socketsecurity/lib/logger'

const logger = getDefaultLogger()

logger.info('Building...')
logger.success('Build complete!')
logger.warn('Using cached artifact')
logger.fail('Build failed')
```

### spawn() Usage

**NEVER change `shell: WIN32` to `shell: true`**:

```javascript
const WIN32 = process.platform === 'win32'

spawn('command', ['arg1', 'arg2'], {
  cwd: packageRoot,
  stdio: 'inherit',
  shell: WIN32  // ✅ Correct: Windows only
})
```

### Clean Before Rebuild

**ALWAYS run clean script before rebuilding**:

```bash
pnpm run clean  # Invalidates checkpoints + caches
pnpm run build  # Fresh build
```

Manual checkpoint deletion is incomplete and error-prone.

### No Backward Compatibility

**FORBIDDEN** to maintain backward compatibility:
- We're our only consumers
- Remove unused code completely
- No compat layers, feature flags, or deprecation paths
- Make clean API changes without transitional states

---

## Development Workflow

### Initial Setup

```bash
# Clone with submodules (LIEF, curl, lzfse, onnxruntime, yoga)
git clone --recursive https://github.com/SocketDev/socket-btm.git
cd socket-btm

# Install dependencies
pnpm install

# Verify external tools (cmake, ninja, etc.)
pnpm --filter build-infra run test
```

### Building Packages

```bash
# Build single package
pnpm --filter binject run build

# Build with dependencies
pnpm --filter node-smol-builder run build  # Auto-builds dependencies

# Force rebuild (ignore checkpoints)
pnpm --filter binject run build --force

# Clean before rebuild
pnpm --filter binject run clean
pnpm --filter binject run build
```

### Testing

```bash
# Run tests
pnpm test                           # All packages
pnpm --filter binject run test      # Single package

# Run with coverage
pnpm --filter build-infra run coverage

# Run integration tests
pnpm --filter node-smol-builder run test:node-suite
```

### Development Tips

1. **Use checkpoints**: Let the build system cache intermediate artifacts
2. **Clean on source changes**: Always clean before rebuilding after C/C++ changes
3. **Check external tools**: Verify cmake, ninja, etc. are available before building
4. **Watch cache versions**: Bump when modifying shared source files
5. **Test cross-platform**: Use Docker for Linux testing on macOS

### Package Development

```bash
# Create new package
mkdir packages/my-package
cd packages/my-package

# Initialize package.json
pnpm init

# Add to workspace
# (automatically detected via pnpm-workspace.yaml)

# Add dependencies
pnpm add build-infra@workspace:*

# Create standard structure
mkdir src scripts test
```

---

## References

- **Testing Patterns**: [docs/testing-patterns.md](docs/testing-patterns.md)
- **Build Infra Exports**: [docs/build-infra-exports-analysis.md](docs/build-infra-exports-analysis.md)
- **Development Guidelines**: [CLAUDE.md](CLAUDE.md)
- **Changelog**: [CHANGELOG.md](CHANGELOG.md)

---

## Glossary

- **BTM**: Build Toolchain Manager (Build Tooling & Models)
- **SEA**: Single Executable Application (Node.js feature)
- **VFS**: Virtual File System (embedded in binary)
- **LIEF**: Library to Instrument Executable Formats
- **LZFSE**: Lempel-Ziv Finite State Entropy (Apple compression)
- **ONNX**: Open Neural Network Exchange
- **WASM**: WebAssembly
- **Checkpoint**: Cached intermediate build artifact

---

**Maintained by**: Socket Security Build Team
**Last Updated**: 2026-02-14
