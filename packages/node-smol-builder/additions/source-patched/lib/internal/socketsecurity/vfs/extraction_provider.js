'use strict'

/**
 * Socket Security: VFS Extraction Providers
 *
 * Provides different strategies for extracting files from VFS to filesystem:
 * - on-disk: Persistent cache in ~/.socket/_dlx/
 * - in-memory: Temporary files (for read-only filesystems)
 * - compat: No-op (VFS disabled)
 *
 * IMPORTANT: This file runs during early bootstrap. Use require('fs') not
 * require('node:fs') - the node: protocol isn't available at this stage.
 */

const {
  CryptoCreateHash,
  FsChmodSync,
  FsCopyFileSync,
  FsExistsSync,
  FsMkdirSync,
  FsMkdtempSync,
  FsSymlinkSync,
  FsWriteFileSync,
  OsHomedir,
  OsTmpdir,
  PathDirname,
  PathJoin,
  PathResolve,
  PathSep,
  ProcessExecPath,
  ProcessPlatform,
} = require('internal/socketsecurity/safe-references')

// Use primordials for protection against prototype pollution
const {
  Error: ErrorConstructor,
  MapPrototypeDelete,
  MapPrototypeGet,
  MapPrototypeHas,
  MapPrototypeSet,
  ObjectFreeze,
  SafeMap,
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

  // Security: Validate linkTarget doesn't contain path traversal sequences
  if (StringPrototypeIncludes(entry.linkTarget, '..')) {
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
    } catch (err) {
      // On Windows, symlinks may require admin privileges
      // Fall back to copying the target if it exists in VFS
      if (ProcessPlatform === 'win32' && err.code === 'EPERM') {
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
          throw err
        }
      } else {
        throw err
      }
    }
  } else {
    // Regular file - extract from VFSEntry
    const content = entry.content
    const mode = entry.mode

    // Write file
    FsWriteFileSync(targetPath, content)

    // Set permissions from TAR metadata
    if (mode !== undefined) {
      try {
        FsChmodSync(targetPath, mode)
      } catch (e) {
        // On Windows, chmod may fail or be no-op
        // Only throw on non-Windows or for unexpected errors
        if (ProcessPlatform !== 'win32' || e?.code !== 'EPERM') {
          throw e
        }
      }
    }
  }
}

/**
 * On-Disk Extraction Provider
 * Extracts files to persistent cache directory: ~/.socket/_dlx/<hash>/
 */
class OnDiskExtractionProvider {
  constructor() {
    // Cache directory based on executable path
    const exeHash = StringPrototypeSlice(
      CryptoCreateHash('sha256').update(ProcessExecPath).digest('hex'),
      0,
      16,
    )

    this._cacheDir = PathJoin(OsHomedir(), '.socket', '_dlx', exeHash, 'vfs')
    this._extracted = new SafeMap()
  }

  _getCacheDir() {
    return this._cacheDir
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
  constructor() {
    // Create unique temp directory for this process
    this._tempDir = FsMkdtempSync(PathJoin(OsTmpdir(), 'vfs-'))
    this._extracted = new SafeMap()
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
 * Compat Extraction Provider (No-Op)
 * Used when VFS is disabled - should never be called
 */
class CompatExtractionProvider {
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
function createExtractionProvider(mode) {
  switch (mode) {
    case VFS_MODE_ON_DISK:
      return new OnDiskExtractionProvider()
    case VFS_MODE_IN_MEMORY:
      return new InMemoryExtractionProvider()
    case VFS_MODE_COMPAT:
      return new CompatExtractionProvider()
    default:
      throw new ErrorConstructor(
        `VFS Error: Unknown extraction mode: ${mode}\n` +
          `  Valid modes: ${VFS_MODE_ON_DISK}, ${VFS_MODE_IN_MEMORY}, ${VFS_MODE_COMPAT}`,
      )
  }
}

module.exports = ObjectFreeze({
  createExtractionProvider,
  OnDiskExtractionProvider,
  InMemoryExtractionProvider,
  CompatExtractionProvider,
})
