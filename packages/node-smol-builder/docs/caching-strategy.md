# Caching Strategy

Complete guide to caching in the Node.js smol builder across local development, CI/CD, and testing.

## Overview

The build system uses multiple caching layers to optimize build times and enable efficient CI/CD workflows:

1. **Build Cache** (`build/{dev,prod}/cache/`) - Compiled binaries + content hash (per mode)
2. **Test Temp** (`os.tmpdir()`) - Temporary test artifacts
3. **GitHub Actions Artifacts** - CI build snapshots

## Cache Hierarchy

```
┌─────────────────────────────────────────────────────────┐
│  Local Development                                       │
├─────────────────────────────────────────────────────────┤
│  build/{dev,prod}/cache/node-compiled-{platform}-{arch} │
│  - Per-mode isolation (dev and prod separate)            │
│  - Persistent across builds                              │
│  - Gitignored (not committed)                            │
│  - Invalidated on source/patch changes                   │
│  - Speeds up iterative development                       │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│  CI/CD (GitHub Actions)                                  │
├─────────────────────────────────────────────────────────┤
│  1. Build jobs: Compile and upload as artifacts         │
│     - build/out/Final/node → GitHub Actions artifact    │
│     - Retention: 7 days                                  │
│                                                          │
│  2. Release job: Download to build/cache/                │
│     - Reconstructs build/cache/ from artifacts          │
│     - Used by scripts/release.mjs for packaging         │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│  Tests                                                   │
├─────────────────────────────────────────────────────────┤
│  os.tmpdir()/socket-btm-sea-tests/                      │
│  - Temporary test artifacts                              │
│  - Cleaned up after test run                             │
│  - OS manages long-term cleanup                          │
└─────────────────────────────────────────────────────────┘
```

## Directory Structure

### `build/{dev,prod}/cache/` - Build Cache

**Purpose**: Store compiled binaries and content hash for cache invalidation (per mode).

**Location**:
- `packages/node-smol-builder/build/dev/cache/`
- `packages/node-smol-builder/build/prod/cache/`

**Contents** (per mode):
```
build/dev/cache/
├── node-compiled-darwin-arm64        # Dev macOS M1/M2/M3 binary
├── node-compiled-darwin-arm64.json   # Metadata (version, timestamp)
├── node-compiled-darwin-x64          # Dev macOS Intel binary
├── node-compiled-darwin-x64.json
├── cache-validation.hash             # Dev SHA-512 hash (cache invalidation)
├── ...

build/prod/cache/
├── node-compiled-darwin-arm64        # Prod macOS M1/M2/M3 binary
├── node-compiled-darwin-arm64.json   # Metadata (version, timestamp)
├── cache-validation.hash             # Prod SHA-512 hash (cache invalidation)
├── ...
```

**Lifecycle**:
- **Created**: After successful compilation
- **Used**: Restored if source unchanged (content hash match)
- **Invalidated**: When patches, additions, or build config changes
- **Cleaned**: `pnpm clean` or `pnpm clean:build`
- **Isolation**: Dev and prod caches fully separated

**Gitignored**: Yes (covered by `**/build/`)

### `os.tmpdir()/socket-btm-sea-tests/` - Test Artifacts

**Purpose**: Temporary test artifacts for SEA integration tests.

**Location**: Platform-specific temp directory:
- macOS/Linux: `/tmp/socket-btm-sea-tests/`
- Windows: `%TEMP%\socket-btm-sea-tests\`

**Contents**:
```
/tmp/socket-btm-sea-tests/
├── hello-plain-js/
│   ├── app.js
│   ├── app.blob
│   ├── sea-config.json
│   └── hello-plain-js (SEA binary)
├── hello-brotli-blob/
├── hello-no-compression/
├── hello-compression-on/
├── invalid-config/
└── missing-js/
```

**Lifecycle**:
- **Created**: During test execution (`beforeAll`)
- **Used**: For SEA blob generation and execution tests
- **Cleaned**: After test completion (`afterAll`)
- **OS Cleanup**: Automatic on system reboot

**Gitignored**: Not applicable (outside project directory)

## Local Development Workflow

### First Build

```bash
pnpm build --prod
```

**Flow**:
1. Check `build/.cache/node.hash` (doesn't exist)
2. Download Node.js source → `build/node-source/`
3. Apply patches
4. Compile Node.js → `build/out/Release/node`
5. Strip binary → `build/out/Stripped/node`
6. Compress binary → `build/out/Compressed/node`
7. Copy to Final → `build/out/Final/node`
8. **Cache binary** → `build/cache/node-compiled-{platform}-{arch}`
9. Write hash → `build/.cache/node.hash`

**Time**: ~30-60 minutes (platform dependent)

### Subsequent Builds (No Changes)

```bash
pnpm build --prod
```

**Flow**:
1. Check `build/.cache/node.hash` (matches current hash)
2. **✅ Using Cached Build** (skip compilation)
3. Restore from `build/cache/node-compiled-{platform}-{arch}`
4. Copy to `build/out/Final/node`

**Time**: ~1 minute

### Subsequent Builds (With Changes)

```bash
# Edit patches/013-socketsecurity_sea_brotli_v24.10.0.patch
pnpm build --prod
```

**Flow**:
1. Check `build/.cache/node.hash` (hash mismatch)
2. Recompile from scratch (cached binary invalidated)
3. Cache new binary
4. Write new hash

**Time**: ~30-60 minutes

### Force Clean Build

```bash
pnpm build --prod --clean
```

**Flow**:
1. Skip hash check (force rebuild)
2. Compile from scratch
3. Cache new binary
4. Write new hash

**Time**: ~30-60 minutes

## CI/CD Workflow

### Build Phase (Parallel)

**.github/workflows/release.yml** - 8 parallel jobs:

```yaml
build-macos-arm64:
  runs-on: macos-14
  steps:
    - run: pnpm build --prod
    - uses: actions/upload-artifact@v4
      with:
        name: node-smol-darwin-arm64
        path: packages/node-smol-builder/build/out/Final/node
        retention-days: 7
```

**Output**: 8 GitHub Actions artifacts (one per platform)

### Release Phase (Sequential)

**.github/workflows/release.yml** - Release job:

```yaml
release:
  needs: [build-macos-arm64, build-macos-x64, ...]
  steps:
    # Download all 8 artifacts to build/cache/
    - uses: actions/download-artifact@v4
      with:
        name: node-smol-darwin-arm64
        path: packages/node-smol-builder/build/cache/

    # Rename to expected format
    - run: mv build/cache/node build/cache/node-compiled-darwin-arm64

    # ... repeat for all 8 platforms

    # Create GitHub release
    - run: pnpm --filter @socketbin/node-smol-builder run release
```

**Flow**:
1. Download 8 artifacts to `build/cache/`
2. Rename to `node-compiled-{platform}-{arch}` format
3. Run `scripts/release.mjs`
4. Release script finds binaries in `build/cache/`
5. Package and upload to GitHub Releases

**Why build/cache/?**
- Release script already looks there (`findBinary()` function)
- Matches local development cache structure
- No code changes needed for CI vs local

## Testing Workflow

### Package Tests (Fast)

```bash
pnpm test package.test.mjs
```

**No caching**: Simple validation tests, no build required.

**Time**: ~100ms

### SEA Tests (Slow)

```bash
pnpm build
pnpm test sea.test.mjs
```

**Flow**:
1. Check if `build/out/Final/node` exists (skip if missing)
2. Create temp directory: `os.tmpdir()/socket-btm-sea-tests/`
3. For each test scenario:
   - Create test files in subdirectory
   - Generate SEA blob
   - Inject blob into binary copy
   - Execute and validate output
4. Clean up temp directory

**Why os.tmpdir()?**
- No project directory pollution
- OS-managed cleanup
- Works across platforms
- Isolated from build cache

**Time**: ~10 seconds (with built binary)

## Cache Invalidation

### What Triggers Invalidation?

The cache is invalidated when the **content hash** changes. This hash includes:

1. **Patches** (`patches/*.patch`):
   ```
   patches/001-socketsecurity_bootstrap_preexec_v24.10.0.patch
   patches/002-socketsecurity_brotli_builtin_v24.10.0.patch
   ...
   patches/013-socketsecurity_sea_brotli_v24.10.0.patch
   ```

2. **Additions** (`additions/**/*`):
   ```
   additions/001-brotli-integration/**/*
   additions/003-compression-tools/**/*
   additions/localeCompare.js
   ```

3. **Build Config** (hardcoded flags):
   ```javascript
   const configureFlags = [
     '--with-intl=small-icu',
     '--without-inspector',
     '--without-npm',
     '--without-corepack',
     ...
   ]
   ```

### What Does NOT Trigger Invalidation?

- Documentation changes (`README.md`, `docs/*.md`)
- Test changes (`test/*.mjs`)
- Release script changes (`scripts/release.mjs`)
- GitHub workflow changes (`.github/workflows/*.yml`)
- Comments in build script

## Performance Metrics

| Scenario | Time (macOS M1) | Time (Linux x64) | Time (Windows) |
|----------|-----------------|------------------|----------------|
| First build | ~30 min | ~45 min | ~60 min |
| Cached build (no changes) | ~1 min | ~1 min | ~1 min |
| Changed patch (rebuild) | ~30 min | ~45 min | ~60 min |
| Clean build | ~30 min | ~45 min | ~60 min |

| Cache Type | Size | Cleanup |
|------------|------|---------|
| build/{dev,prod}/cache/ | ~20-30 MB each | Manual (`pnpm clean`) |
| /tmp/socket-btm-sea-tests/ | ~50-100 MB | Automatic (after tests) |

## Best Practices

### Local Development

✅ **DO**:
- Use cached builds for iterative development
- Run `pnpm build` without `--clean` for faster iterations
- Use `pnpm clean:build` to reset cache when troubleshooting

❌ **DON'T**:
- Commit `build/` directory (gitignored for a reason)
- Manually edit `build/{dev,prod}/cache/` files
- Delete `build/{dev,prod}/cache/` unless cleaning entire build

### CI/CD

✅ **DO**:
- Use GitHub Actions artifacts for cross-job sharing
- Set appropriate retention (7 days for release artifacts)
- Download artifacts to `build/{dev,prod}/cache/` for consistency

❌ **DON'T**:
- Commit CI artifacts to git
- Use Actions cache for large binaries (use artifacts instead)
- Share artifacts across different Node.js versions

### Testing

✅ **DO**:
- Use `os.tmpdir()` for temporary test files
- Clean up test artifacts in `afterAll()`
- Skip SEA tests gracefully if binary missing

❌ **DON'T**:
- Write test artifacts to project directory
- Leave test artifacts after test completion
- Commit test binaries or blobs

## Troubleshooting

### Cache Hit Miss (Expected Rebuild)

**Symptom**: Build recompiles despite no apparent changes

**Diagnosis**:
```bash
# Check current hash
cat build/.cache/node.hash

# Recompute hash (build script does this automatically)
pnpm build --verbose
```

**Cause**: Content of patches, additions, or config changed

**Solution**: This is expected behavior, let the build complete

### Stale Cache (Corrupted Binary)

**Symptom**: Binary crashes or behaves unexpectedly

**Solution**:
```bash
pnpm clean:build
pnpm build --prod
```

### CI Artifact Not Found

**Symptom**: Release job fails to download artifact

**Diagnosis**: Check if build job completed successfully

**Solution**: Re-run failed build jobs before release job

### Test Temp Directory Permission Error

**Symptom**: Tests fail with EACCES or EPERM

**Solution**:
```bash
# Clean up temp directory manually
rm -rf $(node -e "console.log(require('os').tmpdir())")/socket-btm-sea-tests/

# Re-run tests
pnpm test sea.test.mjs
```

## Related Documentation

- [Build Workflow](../README.md#building-smol-nodejs)
- [Release Workflow](release-workflow.md)
- [SEA Usage Guide](sea-usage.md)
- [Test Documentation](../test/README.md)
