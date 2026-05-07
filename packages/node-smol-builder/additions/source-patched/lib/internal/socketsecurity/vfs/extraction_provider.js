'use strict'

// Documentation: docs/additions/lib/internal/socketsecurity/vfs/extraction_provider.js.md

const {
  CryptoCreateHash,
  FsChmodSync,
  FsCopyFileSync,
  FsExistsSync,
  FsMkdirSync,
  FsMkdtempSync,
  FsRenameSync,
  FsSymlinkSync,
  FsUnlinkSync,
  FsWriteFileSync,
  OsHomedir,
  OsTmpdir,
  PathDirname,
  PathJoin,
  PathResolve,
  PathSep,
  ProcessExecPath,
  ProcessPid,
  ProcessPlatform,
} = require('internal/socketsecurity/safe-references')

// Monotonic per-process counter for tmp-file uniqueness. Combined with
// pid this is collision-free across concurrent extracts within one
// process and across processes.
let tmpCounter = 0

const {
  getContent,
} = require('internal/socketsecurity/vfs/tar_parser')

// Use primordials for protection against prototype pollution
const {
  Error: ErrorConstructor,
  MapPrototypeDelete,
  MapPrototypeGet,
  MapPrototypeHas,
  MapPrototypeSet,
  ObjectFreeze,
  SafeMap,
  StringPrototypeEndsWith,
  StringPrototypeIncludes,
  StringPrototypeSlice,
  StringPrototypeStartsWith,
} = primordials

const VFS_MODE_ON_DISK = 'on-disk'
const VFS_MODE_IN_MEMORY = 'in-memory'
const VFS_MODE_COMPAT = 'compat'

/**
 * Validate that a resolved path stays within a root directory.
 * Used for both symlink targets and Windows symlink fallback paths.
 *
 * @param {string} resolvedPath - The fully resolved path to check
 * @param {string} rootDir - Root directory to validate against
 * @returns {boolean} True if path is within root, false otherwise
 */
function isPathWithinRoot(resolvedPath, rootDir) {
  const resolvedRoot = PathResolve(rootDir) + PathSep
  return StringPrototypeStartsWith(resolvedPath, resolvedRoot)
}

/**
 * Validate symlink target for security vulnerabilities.
 *
 * Checks:
 * - Target is not empty
 * - Target doesn't contain '..' path traversal sequences
 * - Resolved target stays within root directory
 *
 * @param {string} relativePath - Symlink path (for error messages)
 * @param {object} entry - VFS entry with linkTarget property
 * @param {string} dirname - Directory where symlink lives
 * @param {string} rootDir - Root directory to validate against (cache or temp)
 * @param {string} rootDirName - Name of root directory type (for error messages)
 * @throws {Error} If symlink validation fails
 */
function validateSymlinkTarget(
  relativePath,
  entry,
  dirname,
  rootDir,
  rootDirName,
) {
  // Security: Validate linkTarget is not empty
  if (entry.linkTarget === '') {
    throw new ErrorConstructor(
      'VFS Security Error: Empty symlink target\n' +
        `  Symlink: ${relativePath}`,
    )
  }

  // Security: Validate linkTarget doesn't contain '..' as a path component.
  // Check both `/` and `\` separators — Windows accepts `\` natively, so a
  // crafted target like `..\..\foo` would slip past a forward-slash-only check.
  const hasTraversal =
    entry.linkTarget === '..' ||
    StringPrototypeStartsWith(entry.linkTarget, '../') ||
    StringPrototypeStartsWith(entry.linkTarget, '..\\') ||
    StringPrototypeIncludes(entry.linkTarget, '/../') ||
    StringPrototypeIncludes(entry.linkTarget, '\\..\\') ||
    StringPrototypeIncludes(entry.linkTarget, '/..\\') ||
    StringPrototypeIncludes(entry.linkTarget, '\\../') ||
    StringPrototypeEndsWith(entry.linkTarget, '/..') ||
    StringPrototypeEndsWith(entry.linkTarget, '\\..')
  if (hasTraversal) {
    throw new ErrorConstructor(
      'VFS Security Error: Symlink contains path traversal (..)\n' +
        `  Symlink: ${relativePath}\n` +
        `  Target: ${entry.linkTarget}`,
    )
  }

  // Security: Validate resolved target stays within root directory
  const resolvedTarget = PathResolve(dirname, entry.linkTarget)
  if (!isPathWithinRoot(resolvedTarget, rootDir)) {
    const resolvedRoot = PathResolve(rootDir) + PathSep
    throw new ErrorConstructor(
      `VFS Security Error: Symlink target escapes ${rootDirName}\n` +
        `  Symlink: ${relativePath}\n` +
        `  Target: ${entry.linkTarget}\n` +
        `  Resolved: ${resolvedTarget}\n` +
        `  ${rootDirName}: ${resolvedRoot}`,
    )
  }
}

/**
 * Extract a VFS entry to the filesystem.
 * Handles both symlinks and regular files with proper security validation.
 *
 * @param {string} relativePath - Relative path for the entry
 * @param {object} entry - VFS entry (file or symlink)
 * @param {string} targetPath - Full path to extract to
 * @param {string} rootDir - Root directory for security validation
 * @param {string} rootDirName - Name of root directory type (for error messages)
 */
function extractEntry(relativePath, entry, targetPath, rootDir, rootDirName) {
  // Defense-in-depth path-traversal check. Upstream callers (mount.js)
  // filter out relativePath starting with '..', but a crafted VFS entry
  // like `foo/../../etc/passwd` passes that filter yet still escapes
  // rootDir. Resolve and validate BEFORE any fs operation so the mkdir
  // can't probe outside the cache tree either.
  const resolvedTarget = PathResolve(targetPath)
  if (!isPathWithinRoot(resolvedTarget, rootDir)) {
    throw new ErrorConstructor(
      `VFS Security Error: entry escapes ${rootDirName} root: ${relativePath}`,
    )
  }

  const dirname = PathDirname(targetPath)

  // Create directory structure
  FsMkdirSync(dirname, { recursive: true })

  // Handle symlinks
  if (
    entry &&
    typeof entry === 'object' &&
    entry.type === 'symlink' &&
    entry.linkTarget
  ) {
    // Security: Validate symlink target
    validateSymlinkTarget(relativePath, entry, dirname, rootDir, rootDirName)

    // Create symlink
    try {
      FsSymlinkSync(entry.linkTarget, targetPath)
    } catch (error) {
      // On Windows, symlinks may require admin privileges
      // Fall back to copying the target if it exists in VFS
      if (ProcessPlatform === 'win32' && error.code === 'EPERM') {
        // Try to copy the link target instead
        const linkTargetPath = PathJoin(dirname, entry.linkTarget)

        // Security: Validate fallback target stays within root directory
        const resolvedLinkTarget = PathResolve(linkTargetPath)
        if (!isPathWithinRoot(resolvedLinkTarget, rootDir)) {
          const resolvedRoot = PathResolve(rootDir) + PathSep
          throw new ErrorConstructor(
            `VFS Security Error: Windows symlink fallback target escapes ${rootDirName}\n` +
              `  Symlink: ${relativePath}\n` +
              `  Target: ${entry.linkTarget}\n` +
              `  Fallback: ${linkTargetPath}\n` +
              `  Resolved: ${resolvedLinkTarget}\n` +
              `  ${rootDirName}: ${resolvedRoot}`,
          )
        }

        if (FsExistsSync(linkTargetPath)) {
          FsCopyFileSync(linkTargetPath, targetPath)
        } else {
          throw error
        }
      } else {
        throw error
      }
    }
  } else {
    // Regular file - extract from VFSEntry. Files > LAZY_CONTENT_THRESHOLD
    // are stored with _sourceBuffer/_bufferOffset/_bufferLength and no
    // materialized `content`; getContent() materializes on demand.
    const content = getContent(entry)
    const { mode } = entry

    // If target already exists, skip. Another process/worker sharing
    // the cache dir (common for SEA binaries used as pipeline CLIs)
    // may have produced it. FsExistsSync is a fast short-circuit;
    // atomic rename below still handles the concurrent case.
    if (FsExistsSync(targetPath)) {
      return
    }

    // Atomic write: stream to a unique tmp file alongside the target,
    // chmod, then rename into place. `rename` is atomic on POSIX and
    // on Windows with `MOVEFILE_REPLACE_EXISTING` semantics. Without
    // this, concurrent extract() calls from two processes sharing the
    // cache dir could interleave mid-write and produce truncated
    // binaries — observed as "Unexpected token" errors on require() of
    // half-written JS or SIGILL on half-written .node addons.
    const tmpPath = `${targetPath}.tmp.${ProcessPid}.${++tmpCounter}`
    FsWriteFileSync(tmpPath, content)
    if (mode !== undefined) {
      try {
        FsChmodSync(tmpPath, mode)
      } catch (error) {
        if (ProcessPlatform !== 'win32' || error?.code !== 'EPERM') {
          try {
            FsUnlinkSync(tmpPath)
          } catch {
            // Best-effort cleanup.
          }
          throw error
        }
      }
    }
    try {
      FsRenameSync(tmpPath, targetPath)
    } catch (error) {
      // If another process beat us to it, the target exists; treat as
      // success. Clean up our tmp.
      try {
        FsUnlinkSync(tmpPath)
      } catch {
        // Best-effort.
      }
      if (!FsExistsSync(targetPath)) {
        throw error
      }
    }
  }
}

/**
 * On-Disk Extraction Provider
 * Extracts files to persistent cache directory: ~/.socket/_dlx/<hash>/
 */
class OnDiskExtractionProvider {
  constructor(options) {
    const extractDir = options?.extractDir
    if (extractDir) {
      this._cacheDir = extractDir
    } else {
      // Default: ~/.socket/_dlx/<hash>/
      const exeHash = StringPrototypeSlice(
        CryptoCreateHash('sha256').update(ProcessExecPath).digest('hex'),
        0,
        16,
      )
      this._cacheDir = PathJoin(OsHomedir(), '.socket', '_dlx', exeHash)
    }
    this._extracted = new SafeMap()
  }

  _getCacheDir() {
    return this._cacheDir
  }

  getCacheStats() {
    return {
      __proto__: null,
      mode: VFS_MODE_ON_DISK,
      cacheDir: this._cacheDir,
      extractedCount: this._extracted.size,
      persistent: true,
    }
  }

  getExtracted(relativePath) {
    // Check memory cache first
    if (MapPrototypeHas(this._extracted, relativePath)) {
      const cachedPath = MapPrototypeGet(this._extracted, relativePath)
      // Re-validate path still exists (TOCTOU protection)
      if (FsExistsSync(cachedPath)) {
        return cachedPath
      }
      // Path was deleted, invalidate cache entry
      MapPrototypeDelete(this._extracted, relativePath)
    }

    // Check if file exists on disk
    const cachedPath = PathJoin(this._cacheDir, relativePath)
    if (FsExistsSync(cachedPath)) {
      MapPrototypeSet(this._extracted, relativePath, cachedPath)
      return cachedPath
    }

    return undefined
  }

  extract(relativePath, entry) {
    const targetPath = PathJoin(this._cacheDir, relativePath)

    // Extract entry using shared helper
    extractEntry(relativePath, entry, targetPath, this._cacheDir, 'Cache')

    // Cache the result
    MapPrototypeSet(this._extracted, relativePath, targetPath)

    return targetPath
  }
}

/**
 * In-Memory Extraction Provider
 * Extracts files to temporary directory (for read-only filesystems)
 */
class InMemoryExtractionProvider {
  constructor(options) {
    const extractDir = options?.extractDir
    if (extractDir) {
      this._tempDir = extractDir
    } else {
      // Create unique temp directory for this process
      this._tempDir = FsMkdtempSync(PathJoin(OsTmpdir(), 'vfs-'))
    }
    this._extracted = new SafeMap()
  }

  // Parallels OnDiskExtractionProvider — mount.js's getCacheDir()
  // falls back to PathDirname(ProcessExecPath) when this method is
  // absent, which returns the wrong path for in-memory extractions
  // (files live under OsTmpdir()/vfs-XXXX, not next to the binary).
  // fs_shim's overlay-mode path rewrite depends on this value.
  _getCacheDir() {
    return this._tempDir
  }

  getCacheStats() {
    return {
      __proto__: null,
      mode: VFS_MODE_IN_MEMORY,
      cacheDir: this._tempDir,
      extractedCount: this._extracted.size,
      persistent: false,
    }
  }

  getExtracted(relativePath) {
    const cachedPath = MapPrototypeGet(this._extracted, relativePath)
    if (cachedPath) {
      // Re-validate path still exists (staleness protection)
      if (FsExistsSync(cachedPath)) {
        return cachedPath
      }
      // Path was deleted, invalidate cache entry
      MapPrototypeDelete(this._extracted, relativePath)
    }
    return undefined
  }

  extract(relativePath, entry) {
    const targetPath = PathJoin(this._tempDir, relativePath)

    // Extract entry using shared helper
    extractEntry(relativePath, entry, targetPath, this._tempDir, 'TempDir')

    // Cache the result
    MapPrototypeSet(this._extracted, relativePath, targetPath)

    return targetPath
  }
}

/**
 * No-Op Provider
 * Used when VFS is disabled - should never be called
 */
class NoopProvider {
  getCacheStats() {
    return {
      __proto__: null,
      mode: VFS_MODE_COMPAT,
      cacheDir: undefined,
      extractedCount: 0,
      persistent: false,
    }
  }

  getExtracted() {
    return undefined
  }

  extract(relativePath) {
    throw new ErrorConstructor(
      'VFS Error: Extraction not supported in compat mode\n' +
        `  Attempted to extract: ${relativePath}\n` +
        '  This indicates VFS is disabled or not configured',
    )
  }
}

/**
 * Create extraction provider based on VFS mode
 */
function createExtractionProvider(mode, options) {
  switch (mode) {
    case VFS_MODE_ON_DISK: {
      return new OnDiskExtractionProvider(options)
    }
    case VFS_MODE_IN_MEMORY: {
      return new InMemoryExtractionProvider(options)
    }
    case VFS_MODE_COMPAT: {
      return new NoopProvider()
    }
    default: {
      throw new ErrorConstructor(
        `VFS Error: Unknown extraction mode: ${mode}\n` +
          `  Valid modes: ${VFS_MODE_ON_DISK}, ${VFS_MODE_IN_MEMORY}, ${VFS_MODE_COMPAT}`,
      )
    }
  }
}

module.exports = ObjectFreeze({
  __proto__: null,
  NoopProvider,
  InMemoryExtractionProvider,
  OnDiskExtractionProvider,
  createExtractionProvider,
})
