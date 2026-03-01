# build-infra Exports Analysis

**Date**: 2026-02-14
**Status**: Recommendation for API cleanup

## Summary

The `build-infra` package currently exports 44 modules. Analysis of actual usage across the monorepo shows:
- **High usage** (10+ imports): 4 modules
- **Moderate usage** (5-9 imports): 5 modules
- **Light usage** (1-4 imports): 16 modules
- **Unused** (0 imports): 6 modules

**Recommendation**: Consider reducing exports from 44 → ~25 modules (remove 6 unused + move 13 rarely-used internal utilities)

---

## Usage Analysis

### Tier 1: Core Public API (Heavy Usage - 10+ imports)

| Module | Import Count | Purpose | Keep? |
|--------|--------------|---------|-------|
| `lib/constants` | 59 | Build stages, modes, checkpoints | ✅ YES - Essential |
| `lib/checkpoint-manager` | 26 | Checkpoint creation/validation | ✅ YES - Core functionality |
| `lib/build-helpers` | 23 | Shared build utilities | ✅ YES - Core functionality |
| `lib/build-output` | 13 | Output directory management | ✅ YES - Core functionality |

**Total**: 4 modules, 121 imports

---

### Tier 2: Common Utilities (Moderate Usage - 5-9 imports)

| Module | Import Count | Purpose | Keep? |
|--------|--------------|---------|-------|
| `lib/platform-mappings` | 8 | Platform/arch detection | ✅ YES - Cross-platform builds |
| `lib/tool-installer` | 7 | Install external tools | ✅ YES - Build dependencies |
| `lib/build-env` | 7 | Build environment setup | ✅ YES - Configuration |
| `lib/version-helpers` | 6 | Version string parsing | ✅ YES - Common utility |
| `lib/path-builder` | 6 | Path construction | ✅ YES - Cross-platform paths |
| `lib/clean-builder` | 5 | Clean build artifacts | ✅ YES - Build lifecycle |

**Total**: 6 modules, 39 imports

---

### Tier 3: Specialized/Light Usage (1-4 imports)

| Module | Import Count | Purpose | Keep? |
|--------|--------------|---------|-------|
| `lib/emscripten-installer` | 4 | Install Emscripten | ✅ YES - WASM builds need this |
| `lib/test/helpers` | 3 | Test utilities | ✅ YES - Test infrastructure |
| `lib/tarball-utils` | 3 | Tar extraction | ✅ YES - Checkpoint extraction |
| `lib/python-installer` | 3 | Install Python | ✅ YES - ML model builds need this |
| `lib/lzfse-init` | 3 | Initialize LZFSE | ✅ YES - Compression dependency |
| `wasm-synced/generate-sync-phase` | 2 | WASM sync wrappers | ✅ YES - WASM builds |
| `lib/pinned-versions` | 2 | Version pinning | ✅ YES - Reproducible builds |
| `wasm-synced/wasm-sync-wrapper` | 1 | WASM sync utilities | ✅ YES - WASM builds |
| `lib/sign` | 1 | Code signing | ✅ YES - macOS binary signing |
| `lib/setup-build-toolchain` | 1 | Toolchain setup | ✅ YES - Build initialization |
| `lib/patch-validator` | 1 | Validate patches | ✅ YES - Node.js patching |
| `lib/libdeflate-init` | 1 | Initialize libdeflate | ✅ YES - Compression dependency |
| `lib/github-releases` | 1 | GitHub releases API | ✅ YES - Binary downloads |
| `lib/get-simple-checkpoint-chain` | 1 | Checkpoint ordering | ✅ YES - Build system |
| `lib/compiler-installer` | 1 | Install compilers | ✅ YES - Cross-compilation |
| `lib/emscripten-builder` | (not counted, but exists) | Emscripten builds | ✅ YES - WASM builds |

**Total**: 15+ modules, ~30+ imports

---

### Tier 4: UNUSED (0 imports) - **Consider Removing**

| Module | Import Count | Purpose | Action |
|--------|--------------|---------|--------|
| `lib/cache-key` | 0 | Generate cache keys | ❌ REMOVE or mark internal |
| `lib/cmake-builder` | 0 | CMake wrapper | ❌ REMOVE - use lib/build-helpers instead |
| `lib/download-with-progress` | 0 | Download with progress bar | ❌ REMOVE or mark internal |
| `lib/rust-builder` | 0 | Rust build wrapper | ❌ REMOVE - not used yet |
| `lib/wasm-pipeline` | 0 | WASM build pipeline | ❌ REMOVE - superseded by emscripten-builder |
| `lib/onnx-helpers` | 0 | ONNX build helpers | ❌ REMOVE - models package doesn't use it |

**Total**: 6 modules, 0 imports

---

### Tier 5: Potentially Internal (Few/No Imports)

| Module | Import Count | Status | Recommendation |
|--------|--------------|--------|----------------|
| `lib/check-tools` | 0 | Used internally by tool-installer | 🔒 Mark as internal |
| `lib/ci-cleanup-paths` | 0 | CI-specific cleanup | 🔒 Mark as internal or remove |
| `lib/docker-builder` | 0 | Docker builds | ⚠️ Keep for CI, but rarely used locally |
| `lib/extraction-cache` | 0 | Extraction caching | 🔒 Mark as internal (used by checkpoint-manager?) |
| `lib/install-tools` | 0 | Install tools wrapper | 🔒 Mark as internal (used by tool-installer) |
| `lib/local-build-setup` | 0 | Local dev setup | ⚠️ Keep for onboarding |
| `lib/preflight-checks` | 0 | Pre-build validation | 🔒 Mark as internal |
| `lib/python-runner` | 0 | Run Python scripts | 🔒 Mark as internal (used by python-installer?) |
| `lib/script-runner` | 0 | Generic script runner | 🔒 Mark as internal |
| `lib/test-helpers` | 0 | Test helpers | ⚠️ Keep for tests |
| `lib/wasm-helpers` | 0 | WASM utilities | 🔒 Mark as internal (used by wasm-synced?) |

**Total**: 11 modules with unclear status

---

## Recommendations

### Option 1: Conservative Cleanup (Remove only truly unused)

**Remove 6 modules** with 0 imports and no internal usage:
- ❌ `lib/cache-key`
- ❌ `lib/cmake-builder`
- ❌ `lib/download-with-progress`
- ❌ `lib/rust-builder`
- ❌ `lib/wasm-pipeline`
- ❌ `lib/onnx-helpers`

**Result**: 44 → 38 exports (14% reduction)

### Option 2: Aggressive Cleanup (Internal + Unused)

**Remove unused** (6 modules) + **Mark as internal** (11 modules):
- Move internal modules to `lib/internal/` directory
- Keep exports for widely-used modules only
- Internal modules can still be used within build-infra, just not exported

**Result**: 44 → 27 exports (39% reduction)

### Option 3: Minimal Cleanup (Document only)

**Don't remove** any exports, just:
- Add JSDoc comments marking which modules are public vs internal
- Add `@internal` tag for modules that shouldn't be directly imported
- Update README.md with clear API documentation

**Result**: 44 exports (0% reduction, but better documentation)

---

## Proposed Public API (Option 2)

If we implement Option 2, the public API would be:

### Build Orchestration (4 modules)
- `lib/constants` - Build stages, modes, paths
- `lib/checkpoint-manager` - Checkpoint lifecycle
- `lib/build-helpers` - Core build utilities
- `lib/build-output` - Output management

### Platform/Environment (4 modules)
- `lib/platform-mappings` - Platform detection
- `lib/build-env` - Environment configuration
- `lib/version-helpers` - Version utilities
- `lib/path-builder` - Path construction

### Tool Management (3 modules)
- `lib/tool-installer` - Install external tools
- `lib/setup-build-toolchain` - Toolchain setup
- `lib/compiler-installer` - Compiler installation

### Specialized Builders (5 modules)
- `lib/emscripten-builder` - WASM/Emscripten builds
- `lib/emscripten-installer` - Emscripten installation
- `wasm-synced/generate-sync-phase` - WASM sync generation
- `wasm-synced/wasm-sync-wrapper` - WASM wrapper utilities
- `lib/python-installer` - Python installation

### Build Dependencies (5 modules)
- `lib/tarball-utils` - Tar operations
- `lib/libdeflate-init` - Compression library
- `lib/lzfse-init` - LZFSE compression
- `lib/github-releases` - Binary downloads
- `lib/pinned-versions` - Version management

### Maintenance (3 modules)
- `lib/clean-builder` - Cleanup operations
- `lib/sign` - Code signing (macOS)
- `lib/get-simple-checkpoint-chain` - Checkpoint ordering

### Testing (2 modules)
- `lib/test/helpers` - Test utilities
- `lib/test-helpers` - Legacy test helpers (merge with test/helpers?)

**Total**: 27 modules (17 fewer than current)

---

## Implementation Plan

### Phase 1: Analysis (DONE)
- ✅ Count actual imports across monorepo
- ✅ Identify unused exports
- ✅ Categorize by usage tier

### Phase 2: Safe Removals
1. Remove 6 completely unused modules:
   ```bash
   rm packages/build-infra/lib/cache-key.mjs
   rm packages/build-infra/lib/cmake-builder.mjs
   rm packages/build-infra/lib/download-with-progress.mjs
   rm packages/build-infra/lib/rust-builder.mjs
   rm packages/build-infra/lib/wasm-pipeline.mjs
   rm packages/build-infra/lib/onnx-helpers.mjs
   ```

2. Update package.json exports (remove 6 lines)

3. Run tests to ensure nothing breaks:
   ```bash
   pnpm --filter build-infra test
   pnpm test  # Full monorepo test
   ```

### Phase 3: Internal Refactoring (Optional)
1. Create `lib/internal/` directory
2. Move 11 internal-only modules
3. Update imports within build-infra
4. Update package.json exports
5. Test thoroughly

### Phase 4: Documentation
1. Add JSDoc to all public API modules
2. Create `packages/build-infra/API.md` documenting public exports
3. Add examples for common use cases
4. Mark any remaining internal exports with `@internal`

---

## Breaking Changes Assessment

### Safe Removals (No Breaking Changes)
These 6 modules have 0 imports, so removal is safe:
- cache-key, cmake-builder, download-with-progress
- rust-builder, wasm-pipeline, onnx-helpers

### Internal Refactoring (Potentially Breaking)
If we move modules to `lib/internal/`, any external imports would break. Need to:
1. Check if any external packages import these
2. If yes, keep exports but mark `@internal`
3. If no, move to internal/ directory

### Test Coverage
Current test coverage for build-infra:
- 12 test files in `test/`
- Tests cover: build-env, build-helpers, cache-key (!), checkpoint-manager, emscripten-installer, patch-validator, path-builder, pinned-versions, preflight-checks, python-installer, script-runner, tool-installer

**Note**: Tests exist for `cache-key` even though it has 0 imports. Verify if it's actually dead code or just not imported yet.

---

## Decision Needed

**Question for maintainer**: Which option should we implement?

- **Option 1** (Conservative): Remove 6 unused modules → 38 exports
- **Option 2** (Aggressive): Remove 6 + Internalize 11 → 27 exports
- **Option 3** (Minimal): Document only → 44 exports

**Recommendation**: Start with **Option 1** (remove 6 unused), then evaluate **Option 3** (document the rest) before considering **Option 2** (refactoring).

This provides immediate cleanup with zero risk, better documentation, and leaves the door open for future refactoring if needed.
