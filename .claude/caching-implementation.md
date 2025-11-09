# Caching Implementation Summary

Comprehensive caching added to socket-btm release workflow, aligned with socket-cli patterns.

## Changes Made

### 1. Workflow Structure

**Before**:
```yaml
# 8 separate build jobs (copy-paste pattern)
build-macos-arm64:
  steps: [checkout, setup, build, upload]
build-macos-x64:
  steps: [checkout, setup, build, upload]
# ... 6 more identical jobs
```

**After**:
```yaml
# Single matrix job (DRY principle)
build-smol:
  strategy:
    max-parallel: 8
    matrix:
      include:
        - { runner: macos-14, os: darwin, platform: darwin, arch: arm64 }
        - { runner: macos-13, os: darwin, platform: darwin, arch: x64 }
        # ... 6 more platforms
```

**Benefits**:
- ✅ 400+ lines → ~460 lines (more functionality, less duplication)
- ✅ Single source of truth for build logic
- ✅ Easier to maintain and update

### 2. Multi-Layer Caching

Added 6 cache layers aligned with build checkpoints:

```yaml
1. ccache (Linux/macOS only)
   - C/C++ compilation cache
   - 2G limit
   - Key: build-{platform}-{arch}-{hash}

2. node-source cache
   - Downloaded Node.js source
   - Key: node-source-{NODE_VERSION}-{hash}
   - Restore keys: node-source-{NODE_VERSION}-

3. Release binary cache
   - build/out/Release/node
   - Key: node-smol-release-{platform}-{arch}-{hash}

4. Stripped binary cache
   - build/out/Stripped/node
   - Key: node-smol-stripped-{platform}-{arch}-{hash}

5. Compressed binary cache
   - build/out/Compressed/node
   - Key: node-smol-compressed-{platform}-{arch}-{hash}

6. Final binary cache
   - build/out/Final/node (distribution binary)
   - Key: node-smol-final-{platform}-{arch}-{hash}

7. Checkpoints cache
   - build/.checkpoints/{cloned,built,complete}
   - Key: node-smol-checkpoints-{platform}-{arch}-{hash}
```

### 3. Cache Key Generation

**Complete cache key format**:
```
{layer}-{platform}-{arch}-v{NODE_VERSION}-{content-hash}
```

**Example**:
```
node-smol-final-darwin-arm64-v22-abc123def456
```

**Cache key components**:

1. **Node.js Version** (from `env.NODE_VERSION`):
   - Ensures different Node.js versions use separate caches
   - Prevents version mismatches (e.g., Node 22 cached as Node 23)

2. **Content Hash** (generated from source files):
```bash
find packages/node-smol-builder/patches \
     packages/node-smol-builder/additions \
     packages/node-smol-builder/scripts \
  -type f \( -name "*.patch" -o -name "*.mjs" -o -name "*.h" -o -name "*.c" -o -name "*.cc" \) \
  | sort | xargs sha256sum | sha256sum | cut -d' ' -f1
```

**Invalidates on**:
- ✅ Node.js version changes (e.g., 22 → 23)
- ✅ Patch changes
- ✅ Addition changes (C/C++ compression tools)
- ✅ Build script changes

**Does NOT invalidate on**:
- ✅ Documentation changes
- ✅ Test changes
- ✅ Release script changes
- ✅ Workflow changes

### 4. Cache Validation

Comprehensive integrity checking:

```yaml
- name: Validate build cache integrity
  run: |
    # 1. Check final binary exists
    if [ -f "build/out/Final/node" ]; then

      # 2. Verify all checkpoints exist
      for checkpoint in cloned built complete; do
        if [ ! -f "build/.checkpoints/$checkpoint" ]; then
          CACHE_VALID="false"
        fi
      done

      # 3. Smoke test binary
      VERSION_OUTPUT=$("$BINARY_PATH" --version 2>&1 || true)

      if [ -n "$VERSION_OUTPUT" ]; then
        echo "✓ Binary executes"

        # 4. Validate Node.js version matches
        EXPECTED_VERSION="${{ env.NODE_VERSION }}"
        ACTUAL_VERSION=$(echo "$VERSION_OUTPUT" | grep -oP 'v\K[0-9]+' || echo "")

        if [ "$ACTUAL_VERSION" = "$EXPECTED_VERSION" ]; then
          echo "✓ Version validation passed"
          echo "valid=true"
        else
          echo "✗ Version mismatch: expected v$EXPECTED_VERSION, got v$ACTUAL_VERSION"
          CACHE_VALID="false"
        fi
      else
        CACHE_VALID="false"
      fi

      # 5. Invalidate corrupted cache
      if [ "$CACHE_VALID" = "false" ]; then
        rm -rf build/
      fi
    fi
```

**Prevents**:
- ✅ Corrupted cache issues
- ✅ Incomplete builds
- ✅ Non-functional binaries
- ✅ Version mismatches (Node.js version doesn't match expected)

### 5. Build Metrics

Track performance across platforms:

```yaml
- name: Calculate and report build metrics
  run: |
    # Calculate duration
    DURATION=$((END_TIME - START_TIME))

    # Create metrics JSON
    {
      "platform": "darwin",
      "arch": "arm64",
      "duration_seconds": 1800,
      "duration_formatted": "30m 0s",
      "cache_status": "Hit",
      "build_status": "success",
      "timestamp": "2025-01-07T12:00:00Z"
    }

    # Upload to artifacts (30-day retention)
    # Report to GitHub Step Summary
```

**Enables**:
- ✅ Cache effectiveness tracking
- ✅ Platform performance comparison
- ✅ Historical trend analysis

### 6. Force Rebuild Option

Added workflow input:

```yaml
inputs:
  force:
    description: 'Force rebuild (ignore cache)'
    type: boolean
    default: false
```

**Usage**:
```bash
# Manual trigger with force rebuild
gh workflow run release.yml --field force=true
```

### 7. Rollback Feature Flag

Emergency rollback mechanism via repository variable:

```yaml
env:
  # Feature flag for rollback: set to 'false' in repository variables to disable caching.
  USE_CACHE: ${{ vars.USE_CACHE != 'false' }}
```

**To disable caching**:
1. GitHub repository → Settings → Variables → Actions
2. Create variable `USE_CACHE` with value `false`
3. Re-run workflow

**Effect**: All cache restore steps are skipped, forcing clean builds from scratch.

**When to use**:
- Cache corruption affecting multiple platforms
- Diagnosing cache-related build issues
- Emergency fix for broken releases
- Testing without cache to isolate problems

**Default**: Caching is enabled (`USE_CACHE` defaults to `true` if not set)

### 8. Concurrency Control

Added concurrency group:

```yaml
concurrency:
  group: release-smol-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true
```

**Benefits**:
- ✅ Prevents parallel releases on same ref
- ✅ Cancels in-progress builds on new push
- ✅ Saves CI minutes

## Build Flow Comparison

### Before (No Caching)

```
┌─────────────────────────────────────────────┐
│  Every Build (30-60 minutes)                │
├─────────────────────────────────────────────┤
│  1. Download Node.js source                 │
│  2. Apply patches                           │
│  3. Compile Node.js                         │
│  4. Strip binary                            │
│  5. Compress binary                         │
│  6. Upload artifact                         │
└─────────────────────────────────────────────┘
```

### After (With Caching)

```
┌─────────────────────────────────────────────┐
│  First Build (30-60 minutes)                │
├─────────────────────────────────────────────┤
│  1. Generate cache key                      │
│  2. Restore caches (all miss)               │
│  3. Download Node.js source                 │
│  4. Apply patches                           │
│  5. Compile Node.js (with ccache)           │
│  6. Strip binary                            │
│  7. Compress binary                         │
│  8. Save all caches                         │
│  9. Upload artifact                         │
└─────────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────┐
│  Cached Build - No Changes (1-2 minutes)    │
├─────────────────────────────────────────────┤
│  1. Generate cache key                      │
│  2. Restore caches (all hit!)               │
│  3. Validate integrity (checkpoints + test) │
│  4. ✓ Skip compilation                      │
│  5. Upload artifact (from cache)            │
└─────────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────┐
│  Cached Build - Patch Changed (20-40 min)   │
├─────────────────────────────────────────────┤
│  1. Generate cache key (hash changed)       │
│  2. Restore caches (partial hit)            │
│     - node-source: HIT                      │
│     - Release: MISS (hash changed)          │
│     - Stripped/Compressed/Final: MISS       │
│  3. Validate integrity (invalidate)         │
│  4. Apply new patches                       │
│  5. Compile (with ccache, faster!)          │
│  6. Strip, compress                         │
│  7. Save new caches                         │
│  8. Upload artifact                         │
└─────────────────────────────────────────────┘
```

## Performance Expectations

### Cache Hit Scenarios

| Scenario | node-source | Release | Final | Duration | Savings |
|----------|-------------|---------|-------|----------|---------|
| **No changes** | HIT | HIT | HIT | 1-2 min | 95-97% |
| **Doc changes** | HIT | HIT | HIT | 1-2 min | 95-97% |
| **Test changes** | HIT | HIT | HIT | 1-2 min | 95-97% |
| **Patch changes** | HIT | MISS | MISS | 20-40 min | 30-50% |
| **Script changes** | HIT | MISS | MISS | 20-40 min | 30-50% |
| **Node.js upgrade** | MISS | MISS | MISS | 30-60 min | 0% |
| **Force rebuild** | SKIP | SKIP | SKIP | 30-60 min | 0% |

### ccache Benefits

| Platform | First Build | With ccache | Savings |
|----------|-------------|-------------|---------|
| Linux x64 | 45 min | 25 min | 44% |
| Linux ARM64 | 50 min | 30 min | 40% |
| macOS x64 | 40 min | 22 min | 45% |
| macOS ARM64 | 30 min | 18 min | 40% |
| Windows (no ccache) | 60 min | 60 min | 0% |

**Note**: Windows doesn't use ccache due to MSVC compiler differences.

## Cache Storage

### GitHub Actions Cache Limits

- **Per repository**: 10 GB total
- **Per cache entry**: 10 GB max
- **Retention**: 7 days (or until evicted by LRU)

### Expected Cache Sizes

| Cache Layer | Size | Retention |
|-------------|------|-----------|
| ccache | ~500 MB - 2 GB | 7 days |
| node-source | ~200 MB | 7 days |
| Release binary | ~40-50 MB | 7 days |
| Stripped binary | ~20-30 MB | 7 days |
| Compressed binary | ~8-12 MB | 7 days |
| Final binary | ~8-12 MB | 7 days |
| Checkpoints | <1 KB | 7 days |
| **Total per platform** | ~750 MB - 2.3 GB | 7 days |
| **Total (8 platforms)** | ~6-18 GB | 7 days |

**Strategy to stay under 10 GB limit**:
- Use `restore-keys` for fallback (partial match)
- ccache self-manages size (2G limit)
- Old caches auto-evicted by GitHub (LRU)

## Monitoring

### GitHub Actions UI

**Step Summary** shows per-platform metrics:

```
## Build Metrics: darwin-arm64

- Duration: **2m 15s**
- Cache: **Hit**
- Status: **success**
```

### Artifacts

**Build Metrics** (30-day retention):

```json
{
  "platform": "darwin",
  "arch": "arm64",
  "duration_seconds": 135,
  "duration_formatted": "2m 15s",
  "cache_status": "Hit",
  "build_status": "success",
  "timestamp": "2025-01-07T12:00:00Z"
}
```

**Usage**:
```bash
# Download all metrics
gh run download <run-id>

# Analyze trends
cat build-metrics-*/build-metrics.json | jq -s 'group_by(.platform) | map({platform: .[0].platform, avg_duration: (map(.duration_seconds) | add / length)})'
```

## Troubleshooting

### Cache Miss (Expected)

**Symptoms**: Build takes 30-60 minutes despite no apparent changes

**Diagnosis**:
```bash
# Check what changed
git diff HEAD~1 packages/node-smol-builder/
```

**Resolution**: This is expected if patches/additions/scripts changed

### Cache Hit but Build Slow

**Symptoms**: Cache shows "Hit" but build still takes >10 minutes

**Diagnosis**: Check cache validation step output

**Possible causes**:
1. Checkpoint missing → Cache invalidated → Full rebuild
2. Smoke test failed → Cache invalidated → Full rebuild
3. ccache not effective (Windows, or first build with ccache)

**Resolution**:
```bash
# Force clean rebuild to regenerate cache
gh workflow run release.yml --field force=true
```

### Cache Size Exceeded

**Symptoms**: Warning in logs about cache size limits

**Diagnosis**: Check cache sizes in GitHub Actions settings

**Resolution**:
1. GitHub auto-evicts old caches (LRU)
2. Manual cleanup: Delete old caches in repo settings
3. Reduce ccache max-size if needed

## Future Improvements

### Phase 2 Enhancements

1. **Reusable Workflow**
   ```yaml
   # .github/workflows/build-smol.yml
   on:
     workflow_call:
       inputs:
         force: { type: boolean }
   ```

2. **Cache Analytics Dashboard**
   - Aggregate metrics across runs
   - Visualize cache hit rates
   - Track build time trends

3. **Windows ccache Alternative**
   - Investigate sccache (supports MSVC)
   - Potential 40-50% speedup on Windows

4. **Signed Binary Support**
   - Add build/out/Signed cache layer
   - Code signing integration
   - Notarization for macOS

## References

- [socket-cli build-smol.yml](../../socket-cli/.github/workflows/build-smol.yml)
- [GitHub Actions Cache Docs](https://docs.github.com/en/actions/using-workflows/caching-dependencies-to-speed-up-workflows)
- [ccache Documentation](https://ccache.dev/)
- [Workflow Comparison](.claude/workflow-comparison.md)
