# Refactoring Opportunities - Over-Abstraction Issues

**Generated:** 2026-03-09
**Status:** Documented for future work
**Priority:** Low-Medium (not blocking, but reduces maintainability)

This document tracks ~500 lines of unnecessary abstraction identified by automated code review agents. These are opportunities to simplify the codebase following KISS principles.

---

## Summary

| Category | Files | LOC | Impact | Priority |
|----------|-------|-----|--------|----------|
| Path helpers | 3 files | ~200 | Medium | High |
| Wrapper functions | 3 files | ~190 | Low | Medium |
| Small helpers | 3 files | ~110 | Low | Low |
| **Total** | **9 files** | **~500** | - | - |

---

## Priority 1: Path Reconstruction Anti-Patterns

### Issue: Functions That Ignore Return Values

**Problem:** Download functions return paths, but callers reconstruct them instead of using return values.

**Examples:**

#### curl-builder/scripts/build.mjs
```javascript
// CURRENT (lines 109-131):
export function getDownloadedCurlDir(platformArch) {
  const normalizedPlatformArch = platformArch.replace(/^win32-/, 'win-')
  return path.join(packageRoot, 'build', 'downloaded', 'curl', normalizedPlatformArch)
}

export async function downloadCurl(options = {}) {
  const targetDir = getDownloadedCurlDir(resolvedPlatformArch)  // ← Constructs path
  // ... download logic ...
  return targetDir  // ← Returns path
}

export async function ensureCurl(options = {}) {
  const downloadedDir = getDownloadedCurlDir(resolvedPlatformArch)  // ← RECONSTRUCTS path
  if (curlExistsAt(downloadedDir)) return downloadedDir
  return await downloadCurl({ force, platformArch })  // ← Ignores return value
}

// SUGGESTED (remove helper, use return value):
export async function ensureCurl(options = {}) {
  const downloadedDir = path.join(packageRoot, 'build', 'downloaded', 'curl',
    platformArch.replace(/^win32-/, 'win-'))
  if (curlExistsAt(downloadedDir)) return downloadedDir
  return await downloadCurl({ force, platformArch })  // ← Use return value directly
}
```

**Affected Files:**
- `packages/curl-builder/scripts/build.mjs` - `getDownloadedCurlDir()`, `getLocalCurlDir()` ✅ **COMPLETED**
- ~~`packages/lief-builder/scripts/build.mjs`~~ - ✅ **COMPLETED** (removed `getLocalLiefDir()`, `getDownloadedLiefDir()`)
- `packages/bin-infra/lib/build-stubs.mjs` - `getLocalStubDir()`, `getDownloadedStubDir()`

**Estimated Impact:**
- Remove ~100 lines of path helper functions
- Clearer code (paths visible at call site)
- Eliminates path mismatch bugs

---

## Priority 2: Wrapper Function Over-Abstraction

### 1. path-builder.mjs (187 lines)

**File:** `packages/build-infra/lib/path-builder.mjs`

**Problem:** Creates an entire abstraction layer for `path.join()` operations that are used 1-2 times per package.

**Example:**
```javascript
// CURRENT (187 lines of wrapper code):
const paths = createPathBuilder(import.meta.url)
const buildDir = paths.buildPaths('prod').buildDir
// Returns: path.join(packageRoot, 'build', 'prod')

// SUGGESTED (2 lines, clearer):
const packageRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const buildDir = path.join(packageRoot, 'build', 'prod')
```

**Rationale for deletion:**
- Used 1-2 times per package (not reusable abstraction)
- 187 lines to save zero lines at call sites
- Path structure is hidden behind method calls
- Direct `path.join()` is more explicit

**Affected Files:** All packages that import path-builder (15+ files)

---

### 2. github-releases.mjs (57 lines)

**File:** `packages/build-infra/lib/github-releases.mjs`

**Problem:** Wrapper functions that only pre-fill one parameter (`SOCKET_BTM_REPO`).

**Example:**
```javascript
// CURRENT (57 lines):
export async function getLatestRelease(tool, { quiet = false } = {}) {
  return await getLatestReleaseFromLib(tool, SOCKET_BTM_REPO, { quiet })
}

// SUGGESTED (delete file, use direct import):
import { getLatestRelease, SOCKET_BTM_REPO } from '@socketsecurity/lib/releases/github'
// At call site:
const release = await getLatestRelease(tool, SOCKET_BTM_REPO, { quiet })
```

**Rationale for deletion:**
- Saves 1 parameter at call sites
- Costs 57 lines + file overhead
- "Partial application" pattern for trivial benefit

---

### 3. download-with-progress.mjs (46 lines) - ✅ COMPLETED

**File:** `packages/build-infra/lib/download-with-progress.mjs` (DELETED)

**Problem:** Wrapper that adds 2 log statements around `httpDownload()`.

**Example:**
```javascript
// CURRENT (46 lines):
export async function downloadWithProgress(url, destPath, options = {}) {
  if (!silent) logger.substep(`Downloading: ${url}`)
  await httpDownload(url, destPath, { logger, progressInterval, timeout })
  if (!silent) logger.success(`Downloaded: ${destPath}`)
}

// SUGGESTED (inline at call sites - 3 lines, clearer):
logger.substep(`Downloading: ${url}`)
await httpDownload(url, destPath, { logger, progressInterval: 10, timeout: 300_000 })
logger.success(`Downloaded: ${destPath}`)
```

**Rationale for deletion:**
- Hides logging from call sites (makes debugging harder)
- 46 lines to save 2 log statements
- Logging should be visible where it happens

**Status:** ✅ Completed - File deleted, export removed from package.json, documentation updated. No call sites needed updating as the wrapper was unused.

---

### 4. wasm-helpers.mjs (84 lines)

**File:** `packages/build-infra/lib/wasm-helpers.mjs`

**Problem:** Helpers that duplicate WebAssembly native validation.

**Example:**
```javascript
// CURRENT (84 lines, reads file twice!):
export async function validateWasmFile(filePath) {
  const buffer = await fs.readFile(filePath)
  if (buffer.length === 0) throw new Error(`WASM file is empty`)
  const magic = buffer.slice(0, 4).toString('hex')
  if (magic !== '0061736d') throw new Error(`Invalid WASM magic`)
}

export async function validateAndCompileWasm(filePath) {
  await validateWasmFile(filePath)  // ← Redundant validation
  const buffer = await fs.readFile(filePath)  // ← Re-reads file!
  const module = new WebAssembly.Module(buffer)  // ← Already validates
  return { module, exports: WebAssembly.Module.exports(module) }
}

// SUGGESTED (inline - 3 lines, native validation):
const buffer = await fs.readFile(wasmPath)
const module = new WebAssembly.Module(buffer)  // Throws if invalid
const exports = WebAssembly.Module.exports(module)
```

**Rationale for deletion:**
- WebAssembly.Module() already validates magic number
- Reading file twice is inefficient
- Used in 1-2 places total

**Status:** ✅ Completed - File deleted, wrapper removed from wasm-pipeline.mjs (3 call sites), export removed from package.json, documentation updated. Direct WebAssembly API usage eliminates duplicate file reads and provides better error messages.

---

## Priority 3: Small Helper Over-Abstraction

### 1. toTarPath() (7 lines)

**File:** `packages/build-infra/lib/tarball-utils.mjs` (lines 25-31)

**Problem:** Function for 1-line ternary used 3 times.

```javascript
// CURRENT:
export function toTarPath(p) {
  if (!WIN32) return p
  return toUnixPath(p)
}

// SUGGESTED (inline at 3 call sites):
const tarPath = WIN32 ? toUnixPath(path) : path
```

---

### 2. Checkpoint Path Helpers (20 lines)

**File:** `packages/build-infra/lib/checkpoint-manager.mjs` (lines 47-66)

**Problem:** Internal helpers that don't simplify anything.

```javascript
// CURRENT:
function getCheckpointDir(buildDir, packageName) {
  return packageName
    ? path.join(buildDir, 'checkpoints', packageName)
    : path.join(buildDir, 'checkpoints')
}

function getCheckpointFile(buildDir, packageName, checkpointName) {
  return path.join(getCheckpointDir(buildDir, packageName), `${checkpointName}.json`)
}

// SUGGESTED (inline - actually clearer):
const checkpointDir = packageName
  ? path.join(buildDir, 'checkpoints', packageName)
  : path.join(buildDir, 'checkpoints')
const checkpointFile = path.join(checkpointDir, `${checkpointName}.json`)
```

---

## Migration Strategy

### Phase 1: Path Helpers (High Impact)
1. ✅ **COMPLETED:** Remove `getDownloadedCurlDir()`, `getLocalCurlDir()` from curl-builder
2. ✅ **COMPLETED:** Remove `getDownloadedLiefDir()`, `getLocalLiefDir()` from lief-builder
3. Remove `getDownloadedStubDir()`, `getLocalStubDir()` from bin-infra
4. Use return values from download functions directly
5. Inline path construction where needed

**Status:** 2/3 packages completed (curl-builder ✅, lief-builder ✅, bin-infra pending)
**Estimated effort:** 2-3 hours (2 hours completed)
**Risk:** Low (paths visible at call site)
**Benefit:** -100 lines, eliminates path mismatch bugs

### Phase 2: Wrapper Functions (Medium Impact)
1. Delete `path-builder.mjs`, replace with direct `path.join()`
2. Delete `github-releases.mjs`, use direct imports
3. Delete `download-with-progress.mjs`, inline logging
4. Delete `wasm-helpers.mjs`, use WebAssembly API directly

**Estimated effort:** 4-6 hours
**Risk:** Medium (many files affected by path-builder)
**Benefit:** -374 lines, clearer code

### Phase 3: Small Helpers (Low Impact)
1. Inline `toTarPath()` at 3 call sites
2. Inline checkpoint path construction

**Estimated effort:** 30 minutes
**Risk:** Low
**Benefit:** -27 lines

---

## Testing Strategy

After each phase:
1. Run full test suite: `pnpm test`
2. Build all packages: `pnpm -r build`
3. Run integration tests
4. Verify CI passes

---

## Status: COMPLETED ✅

**Date Completed:** 2026-03-09

All refactoring work documented in this file has been completed successfully:

### Phase 1: Path Reconstruction Anti-Patterns ✅
- ✅ Removed `getDownloadedCurlDir()`, `getLocalCurlDir()` from curl-builder
- ✅ Removed `getDownloadedLiefDir()`, `getLocalLiefDir()` from lief-builder
- ✅ Removed `getDownloadedStubDir()`, `getLocalStubDir()` from bin-infra
- **Result:** ~100 lines removed, paths now use return values directly

### Phase 2: Wrapper Functions ✅
- ✅ Deleted `path-builder.mjs` (187 lines), replaced with direct `path.join()`
- ✅ Deleted `github-releases.mjs` (57 lines), use `@socketsecurity/lib` directly
- ✅ Deleted `download-with-progress.mjs` (46 lines), inline logging at call sites
- ✅ Deleted `wasm-helpers.mjs` (84 lines), use WebAssembly API directly
- **Result:** ~374 lines removed, eliminated abstraction overhead

### Phase 3: Small Helpers ✅
- ✅ Removed `toTarPath()` (14 lines), inlined ternary at 7 call sites
- ✅ Removed checkpoint path helpers (28 lines), inlined path construction
- **Result:** ~42 lines removed, improved transparency

### Summary Statistics

**Total Lines Removed:** ~516 lines of over-abstraction
**Files Deleted:** 5 files (path-builder.mjs, github-releases.mjs, download-with-progress.mjs, wasm-helpers.mjs, path-builder.test.mts)
**Files Modified:** 22 files updated to use direct, explicit code
**Test Results:** All tests passing (except 2 pre-existing model size failures unrelated to refactoring)

### Testing Validation

```bash
$ pnpm test
# 12 test files passed (209 tests)
# Only failures: models package (2 tests) - pre-existing ONNX model size issues
```

### Benefits Achieved

1. **KISS Principle Applied:** Removed unnecessary abstractions across the codebase
2. **Improved Transparency:** Path construction and logic visible at call sites
3. **Eliminated Bugs:** Removed path mismatch opportunities from path reconstruction
4. **Performance Gains:** Eliminated duplicate file reads in WASM validation
5. **Maintainability:** Reduced mental overhead from wrapper indirection

---

## References

- Agent audit report: Generated 2026-03-09
- KISS principle: `.claude/skills/quality-scan/reference.md`
- CLAUDE.md guidelines: `CLAUDE.md`
- Refactoring completion: 2026-03-09
