# Build Cache Troubleshooting

## Overview

The build system caches compiled Node.js binaries to speed up subsequent builds. However, corrupted cached binaries can cause issues.

## Cache Locations

- **Compiled binary cache**: `build/cache/node-compiled-{platform}-{arch}`
- **Hash cache**: `build/.cache/node.hash`
- **Build output**: `build/out/`
- **Node.js build**: `build/node-source/out/`

## Symptoms of Corrupted Cache

1. Binary segfaults when executing JavaScript (exit code 139):
   ```bash
   ./build/node-source/out/Release/node -e "console.log('test')"
   # Segmentation fault: 11
   ```

2. `--version` works but JavaScript execution fails
3. All builds produce identical broken binaries

## Cache Checkpoints

The build system automatically smoketests cached binaries at checkpoints:

### For Vanilla Node.js (smol):
1. **Version test**: `node --version` (checks binary can start)
2. **JavaScript execution test**: `node -e "console.log('hello world')"` (checks V8 runtime)
3. **Module system test**: `node -e "require('path').join('a','b')"` (checks CommonJS loader)

### For SEA Binaries (socket-sea):
1. **Version test**: `socket --version` (checks binary can start)
2. **Help command test**: `socket --help` (checks bundled CLI application)

If any smoketest fails at a checkpoint, the cache is automatically invalidated and a fresh build occurs.

## Manual Cache Clearing

### Option 1: Use --clean flag (Recommended)

```bash
pnpm --filter @socketbin/node-smol-builder run build --clean
```

This automatically clears cache and forces a fresh compilation.

### Option 2: Manual deletion

```bash
cd packages/node-smol-builder
rm -rf build/cache build/.cache build/out build/node-source/out
pnpm run build --dev
```

## Prevention

The build system now includes:

1. **Pre-cache checkpoint**: Binaries are smoketested before being cached
2. **Post-restore checkpoint**: Cached binaries are smoketested when restored
3. **Automatic invalidation**: Failed smoketests trigger fresh compilation

## Cache Behavior

### When Cache is Used

- Platform, architecture, and Node.js version match
- Cache checkpoint smoketests pass
- No `--clean` flag provided

### When Cache is Skipped

- No cache exists
- Platform/architecture mismatch
- Node.js version mismatch
- Checkpoint smoketests fail
- `--clean` flag provided

## Best Practices

1. **After major changes**: Use `--clean` to ensure fresh build
   ```bash
   pnpm run build --clean
   ```

2. **CI/CD**: Consider periodic cache clearing to prevent accumulation of stale caches

3. **Troubleshooting**: If builds behave unexpectedly, clear cache first

4. **Development**: Normal builds use cache for speed; use `--clean` when needed

## Technical Details

### Cache Key Generation

Cache keys are content-based hashes of:
- Node.js version
- All patch files (changes invalidate cache)
- Build configuration flags
- Platform and architecture

### Checkpoint Smoketests

**For vanilla Node.js (smol)**:
```javascript
// Test 1: Version
await spawn(binary, ['--version'], { timeout: 5_000 })

// Test 2: JavaScript execution
await spawn(binary, ['-e', 'console.log("hello world")'], { timeout: 5_000 })

// Test 3: Module system
await spawn(binary, ['-e', 'require("path").join("a","b")'], { timeout: 5_000 })
```

**For SEA binaries (socket-sea)**:
```javascript
// Test 1: Version
await spawn(binary, ['--version'], { timeout: 5_000 })

// Test 2: Help command (validates bundled CLI)
await spawn(binary, ['--help'], { timeout: 5_000 })
```

All smoketests must pass with exit code 0, or cache is invalidated at checkpoint.

## Related Files

- `scripts/build.mjs`:
  - `smoketestBinary()` function (lines 556-636) - Binary smoketest helper
  - `cacheCompiledBinary()` (lines 683-730) - Pre-cache checkpoint
  - `restoreCachedBinary()` (lines 735-785) - Post-restore checkpoint
- `build/patches/README.md` - Patch documentation
- `.github/workflows/build-smol.yml` - CI cache configuration
