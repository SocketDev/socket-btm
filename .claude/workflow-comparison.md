# Workflow Comparison: socket-cli vs socket-btm

Analysis of build workflows and caching strategies between socket-cli and socket-btm repositories.

## Current State

### socket-cli (Reference Implementation)

**Build Products**:
1. **WASM Binaries** (build-wasm.yml) - ML model inference
2. **Smol Binaries** (build-smol.yml) - Compressed Node.js + CLI
3. **SEA Binaries** (build-sea.yml) - Single Executable Applications

**Key Workflow Features**:

#### 1. Sophisticated Caching Strategy
```yaml
# Multi-layer caching
- ccache for C/C++ compilation (2G limit)
- GitHub Actions cache for build artifacts
- Separate caches for:
  - build/              (full build tree)
  - build/out/Stripped/ (stripped binaries)
  - dist/socket-smol-*  (final binaries)
```

#### 2. Cache Key Generation
```bash
# Content-based hash including:
- patches/**/*.patch
- scripts/**/*.mjs
- additions/**/*.{h,c,cc}
- pnpm-lock.yaml (dependency changes)
- bootstrap/socket dist/ (built dependencies)
```

#### 3. Cache Validation
```yaml
- Check checkpoint files exist (.checkpoints/cloned, built, complete)
- Smoke test binaries (--version)
- Invalidate corrupted caches automatically
```

#### 4. Build Dependencies
```yaml
build-deps job:
  - Build @socketsecurity/bootstrap
  - Build socket CLI
  - Upload as artifacts
  - Consumed by all platform builds
```

#### 5. Platform Matrix
```yaml
strategy:
  max-parallel: 8
  matrix:
    - linux-x64, linux-arm64
    - alpine-x64, alpine-arm64  # musl libc
    - darwin-x64, darwin-arm64
    - win32-x64, win32-arm64
```

#### 6. Windows-Specific Setup
- Automatic Visual Studio detection via vswhere
- vcvarsall.bat environment setup
- Git Unix tools for patch command
- GYP_MSVS_VERSION and GYP_MSVS_OVERRIDE_PATH

#### 7. Alpine Builds
- Docker Buildx with multi-platform support
- Docker layer caching via GitHub Actions cache
- Separate Dockerfile.alpine

#### 8. Build Metrics
- Duration tracking
- Cache hit/miss reporting
- Upload metrics as artifacts (30-day retention)
- GitHub Step Summary integration

### socket-btm (Current Implementation)

**Build Products**:
1. **Smol Binaries** (for release) - No CLI bundling

**Current Workflow** (.github/workflows/release.yml):
```yaml
# Simple approach
- 8 parallel build jobs
- Direct builds (no deps pre-build)
- Upload binaries as artifacts (7-day retention)
- Release job downloads and packages
```

**Missing Features**:
- ❌ No ccache
- ❌ No GitHub Actions cache
- ❌ No cache validation
- ❌ No smoke tests
- ❌ No build metrics
- ❌ No checkpoint files
- ❌ No dependency pre-build
- ❌ Simpler Windows setup (vcbuild.bat only)

## Proposed Alignment

### Strategy

**socket-btm should adopt socket-cli's workflow patterns** but simplified for its scope:

1. **Reusable Workflows**: Create callable workflows for smol/WASM/SEA builds
2. **Shared Caching**: Align cache keys and validation logic
3. **Build Metrics**: Track performance across platforms
4. **Cache Validation**: Prevent corrupted cache issues

### Recommended Changes

#### 1. Create `build-smol.yml` (Aligned)

```yaml
name: 🤏 Smol Binaries

on:
  workflow_call:
    inputs:
      force:
        description: 'Force rebuild (ignore cache)'
        type: boolean
        default: false
  workflow_dispatch:
    inputs:
      force:
        description: 'Force rebuild (ignore cache)'
        type: boolean
        default: false

jobs:
  build-smol:
    name: ⚡ Smol - ${{ matrix.platform }}-${{ matrix.arch }}
    strategy:
      max-parallel: 8
      matrix:
        include:
          - { runner: ubuntu-latest, platform: linux, arch: x64 }
          - { runner: ubuntu-24.04-arm, platform: linux, arch: arm64 }
          - { runner: ubuntu-latest, platform: linux-musl, arch: x64 }
          - { runner: ubuntu-24.04-arm, platform: linux-musl, arch: arm64 }
          - { runner: macos-latest, platform: darwin, arch: x64 }
          - { runner: macos-latest, platform: darwin, arch: arm64 }
          - { runner: windows-latest, platform: win32, arch: x64 }
          - { runner: windows-latest, platform: win32, arch: arm64 }

    steps:
      # ... (follow socket-cli pattern)

      - name: Generate smol build cache key
        run: |
          PATCHES_HASH=$(find packages/node-smol-builder/patches packages/node-smol-builder/additions -type f | sort | xargs sha256sum | sha256sum | cut -d' ' -f1)
          echo "hash=$PATCHES_HASH" >> $GITHUB_OUTPUT

      - name: Setup ccache
        if: matrix.os != 'windows'
        uses: hendrikmuhs/ccache-action@v1.2.14
        with:
          key: build-${{ matrix.platform }}-${{ matrix.arch }}-${{ steps.cache-key.outputs.hash }}
          max-size: 2G

      - name: Restore build cache
        if: inputs.force != true
        uses: actions/cache@v4
        with:
          path: packages/node-smol-builder/build
          key: node-smol-build-${{ matrix.platform }}-${{ matrix.arch }}-${{ steps.cache-key.outputs.hash }}

      - name: Restore binary cache
        if: inputs.force != true
        uses: actions/cache@v4
        with:
          path: packages/node-smol-builder/build/out/Final
          key: node-smol-${{ matrix.platform }}-${{ matrix.arch }}-${{ steps.cache-key.outputs.hash }}

      - name: Validate cache integrity
        run: |
          # Check checkpoints exist
          # Smoke test binary
          # Invalidate if corrupted

      - name: Build smol binary
        if: cache miss or invalid
        run: pnpm --filter @socketbin/node-smol-builder build --prod

      - name: Upload binary
        uses: actions/upload-artifact@v4
        with:
          name: node-smol-${{ matrix.platform }}-${{ matrix.arch }}
          path: packages/node-smol-builder/build/out/Final/node
          retention-days: 7
```

#### 2. Update `release.yml` to Use Workflow Call

```yaml
name: Release Smol Binaries

on:
  push:
    tags:
      - 'node-smol-v*'
  workflow_dispatch:

jobs:
  # Call the build workflow
  build:
    uses: ./.github/workflows/build-smol.yml
    with:
      force: false

  # Release job (unchanged)
  release:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/download-artifact@v4
      # ... rest of release logic
```

#### 3. Add Build Metrics

```yaml
- name: Calculate build metrics
  if: always()
  run: |
    DURATION=$((END_TIME - START_TIME))
    CACHE_STATUS="${{ cache-hit && 'Hit' || 'Miss' }}"

    cat > build-metrics.json <<EOF
    {
      "platform": "${{ matrix.platform }}",
      "arch": "${{ matrix.arch }}",
      "duration_seconds": $DURATION,
      "cache_status": "$CACHE_STATUS"
    }
    EOF

- name: Upload build metrics
  uses: actions/upload-artifact@v4
  with:
    name: build-metrics-${{ matrix.platform }}-${{ matrix.arch }}
    path: build-metrics.json
    retention-days: 30
```

#### 4. Add Cache Validation (Prevent Corruption)

```yaml
- name: Validate build cache integrity
  if: cache-hit
  run: |
    CACHE_VALID="true"

    # Check checkpoint files
    for checkpoint in cloned built complete; do
      if [ ! -f "build/.checkpoints/$checkpoint" ]; then
        echo "Missing checkpoint: $checkpoint"
        CACHE_VALID="false"
      fi
    done

    # Invalidate if corrupted
    if [ "$CACHE_VALID" = "false" ]; then
      rm -rf build/
      echo "Invalidated corrupted cache"
    fi
```

## Caching Strategy Comparison

### socket-cli Approach

```
┌─────────────────────────────────────────────────────────┐
│  Build Dependencies (Separate Job)                       │
├─────────────────────────────────────────────────────────┤
│  1. Build bootstrap package                              │
│  2. Build socket CLI package                             │
│  3. Upload as artifacts                                  │
│  4. Generate deps-hash for cache key                     │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│  Platform Builds (8 Parallel Jobs)                       │
├─────────────────────────────────────────────────────────┤
│  1. Download build-deps artifacts                        │
│  2. Generate cache key (patches + deps-hash)             │
│  3. Restore caches:                                      │
│     - ccache (C/C++ compilation)                         │
│     - build/ (full build tree)                           │
│     - build/out/Stripped/ (stripped binary)              │
│     - dist/socket-smol-* (final binary)                  │
│  4. Validate cache integrity                             │
│  5. Build if cache miss/invalid                          │
│  6. Upload binary + metrics                              │
└─────────────────────────────────────────────────────────┘
```

**Cache Layers**:
1. **ccache** - C/C++ object files (2G, shared across builds)
2. **build/ cache** - Full compilation tree (invalidated by patches)
3. **Stripped/ cache** - Post-strip binary (invalidated by patches)
4. **Final/ cache** - Distribution binary (invalidated by patches + deps)

**Cache Key Formula**:
```
hash(patches + additions + scripts + pnpm-lock + bootstrap-dist + socket-dist)
```

### socket-btm Current Approach

```
┌─────────────────────────────────────────────────────────┐
│  Platform Builds (8 Parallel Jobs)                       │
├─────────────────────────────────────────────────────────┤
│  1. Direct build (no deps pre-build)                     │
│  2. No caching (fresh build every time)                  │
│  3. Upload binary as artifact (7-day retention)          │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│  Release Job                                             │
├─────────────────────────────────────────────────────────┤
│  1. Download all 8 artifacts                             │
│  2. Rename to node-compiled-* format                     │
│  3. Run release.mjs to package                           │
│  4. Create GitHub Release                                │
└─────────────────────────────────────────────────────────┘
```

**Cache Layers**:
- ❌ None (except local build/cache/ which is gitignored)

### Proposed socket-btm Approach

```
┌─────────────────────────────────────────────────────────┐
│  Platform Builds (8 Parallel Jobs)                       │
├─────────────────────────────────────────────────────────┤
│  1. Generate cache key (patches + additions)             │
│  2. Restore caches:                                      │
│     - ccache (C/C++ compilation) [Linux/macOS]           │
│     - build/ (full build tree)                           │
│     - build/out/Final/ (distribution binary)             │
│  3. Validate cache integrity (checkpoints + smoke test)  │
│  4. Build if cache miss/invalid                          │
│  5. Upload binary + metrics                              │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│  Release Job (Unchanged)                                 │
├─────────────────────────────────────────────────────────┤
│  1. Download all 8 artifacts                             │
│  2. Rename to node-compiled-* format                     │
│  3. Run release.mjs to package                           │
│  4. Create GitHub Release                                │
└─────────────────────────────────────────────────────────┘
```

**Cache Layers**:
1. **ccache** - C/C++ object files (2G, Linux/macOS only)
2. **build/ cache** - Full compilation tree
3. **Final/ cache** - Distribution binary

**Cache Key Formula**:
```
hash(patches + additions + scripts)
```

**Benefits**:
- ✅ Faster rebuilds when only docs change
- ✅ Shared compilation cache across builds
- ✅ Corruption detection and recovery
- ✅ Build metrics for performance tracking

## Implementation Plan

### Phase 1: Add Caching to Current Workflow

**File**: `.github/workflows/release.yml`

Changes:
1. Add cache key generation
2. Add ccache setup (Linux/macOS)
3. Add GitHub Actions cache for build/
4. Add cache validation
5. Add smoke tests
6. Add build metrics

**Estimated Time**: 2-3 hours
**Risk**: Low (backwards compatible)

### Phase 2: Extract Reusable Workflow

**Files**:
- `.github/workflows/build-smol.yml` (new, callable)
- `.github/workflows/release.yml` (modified, calls build-smol.yml)

Changes:
1. Create build-smol.yml with workflow_call trigger
2. Move build logic from release.yml to build-smol.yml
3. Update release.yml to call build-smol.yml

**Estimated Time**: 1-2 hours
**Risk**: Low (tested pattern from socket-cli)

### Phase 3: Add WASM/SEA Workflows (Future)

**Files**:
- `.github/workflows/build-wasm.yml` (new)
- `.github/workflows/build-sea.yml` (new)

**Estimated Time**: 4-6 hours per workflow
**Risk**: Medium (new build products)

## Recommendations

### Immediate Actions

1. **Add caching to current workflow** (Phase 1)
   - Fastest time-to-value
   - No structural changes
   - Immediate build time improvements

2. **Add build metrics**
   - Track cache effectiveness
   - Identify slow platforms
   - Justify further optimization

3. **Add cache validation**
   - Prevent corrupted cache issues
   - Automatic recovery

### Future Actions

1. **Extract reusable workflow** (Phase 2)
   - Enable workflow_call for external use
   - Align with socket-cli pattern
   - Enable manual trigger for testing

2. **Add WASM builds** (Phase 3)
   - ML model inference binaries
   - Separate workflow (build-wasm.yml)
   - Docker-based builds

3. **Add SEA builds** (Phase 3)
   - Single executable applications
   - Separate workflow (build-sea.yml)
   - Bundled CLI distribution

## Key Differences to Preserve

### socket-cli (Complex)
- Multiple build products (WASM, Smol, SEA)
- Bootstrap compilation required
- CLI bundling
- E2E test integration
- Publishing to npm

### socket-btm (Simple)
- Single build product (Smol binary)
- No bootstrap compilation
- No CLI bundling
- Release to GitHub only
- Library distribution

**Conclusion**: socket-btm should adopt socket-cli's **caching patterns** but maintain its **simpler scope**.

