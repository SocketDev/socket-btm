'use strict'

/**
 * Socket Security: node-smol Mount and Native Addon Support
 *
 * Handles extracting files from VFS to real filesystem.
 * Critical for native addons (.node files) and user file extraction.
 *
 * IMPORTANT: This file runs during early bootstrap. Use require('fs') not
 * require('node:fs') - the node: protocol isn't available at this stage.
 */

const {
  FsMkdir,
  FsMkdirSync,
  FsWriteFile,
  FsWriteFileSync,
  PathDirname,
  PathJoin,
  PathRelative,
  ProcessExecPath,
  TRAILING_SLASHES_REGEX,
  normalizePath,
} = require('internal/socketsecurity/safe-references')
const {
  createExtractionProvider,
} = require('internal/socketsecurity/vfs/extraction_provider')
const {
  VFS_MODE_IN_MEMORY,
  findVFSKey,
  getVFSConfig,
  getVFSPrefix,
  initVFS,
  readFileFromVFS,
  readdirFromVFS,
  statFromVFS,
  toVFSPath,
} = require('internal/socketsecurity/vfs/loader')

// Use primordials for protection against prototype pollution.
const {
  ArrayPrototypeFilter,
  ArrayPrototypeJoin,
  ArrayPrototypeMap,
  BufferIsBuffer,
  Error: ErrorConstructor,
  MapPrototypeGet,
  ObjectFreeze,
  SafePromiseAllSettled,
  String: StringConstructor,
  StringPrototypeEndsWith,
  StringPrototypeReplace,
  StringPrototypeStartsWith,
} = primordials

// Extraction provider (lazy-initialized based on VFS config)
let _extractionProvider

/**
 * Get extraction provider (lazy-initialized based on VFS config)
 */
function getExtractionProvider() {
  if (_extractionProvider) {
    return _extractionProvider
  }

  // Get VFS configuration to determine extraction mode
  const vfsConfig = getVFSConfig()
  const mode = vfsConfig?.mode || VFS_MODE_IN_MEMORY

  _extractionProvider = createExtractionProvider(mode)

  return _extractionProvider
}

/**
 * Extract a single file entry from VFS using the extraction provider.
 * Shared logic used by both async and sync directory mounting.
 * @param {object} provider - Extraction provider
 * @param {string} entryVfsPath - VFS path of the entry
 * @param {string} entryRelativePath - Relative path for extraction
 */
function extractFileEntry(provider, entryVfsPath, entryRelativePath) {
  // Check if already extracted
  const existing = provider.getExtracted(entryRelativePath)
  if (existing) {
    return
  }

  // Get VFS entry using toVFSPath for consistent key format
  const vfs = initVFS()
  const vfsKey = toVFSPath(entryVfsPath)
  const entry = vfs ? MapPrototypeGet(vfs, vfsKey) : undefined

  if (!entry) {
    throw new ErrorConstructor(
      `VFS Error: Failed to read file from VFS during directory extraction: ${entryVfsPath}\n` +
        '  File exists in directory listing but could not be read\n' +
        '  This may indicate VFS corruption',
    )
  }

  // Validate VFSEntry structure
  validateVFSEntry(entry, entryVfsPath)

  try {
    provider.extract(entryRelativePath, entry)
  } catch (err) {
    const config = getVFSConfig()
    const mode = config?.mode || VFS_MODE_IN_MEMORY
    throw new ErrorConstructor(
      'VFS Error: Failed to extract directory file\n' +
        `  VFS path: ${entryVfsPath}\n` +
        `  Extraction mode: ${mode}\n` +
        `  Error: ${err.message}\n` +
        '  Hint: Try NODE_VFS_MODE=in-memory if filesystem is read-only',
    )
  }
}

/**
 * Get the output directory path for directory extraction.
 * @param {object} provider - Extraction provider
 * @param {string} normalizedRelativePath - Normalized relative path
 * @returns {string} Output directory path
 */
function getDirectoryOutputPath(provider, normalizedRelativePath) {
  if (provider._getCacheDir) {
    return PathJoin(provider._getCacheDir(), normalizedRelativePath)
  }
  // Fallback for providers without _getCacheDir (e.g., in-memory)
  return PathJoin(PathDirname(ProcessExecPath), normalizedRelativePath)
}

/**
 * Get cache directory for extracted files.
 * @deprecated Use extraction provider directly
 */
function getCacheDir() {
  const provider = getExtractionProvider()
  // For backward compatibility with on-disk provider
  if (provider._getCacheDir) {
    return provider._getCacheDir()
  }
  return PathDirname(ProcessExecPath)
}

/**
 * Validate VFSEntry structure
 * @param {*} entry - Entry from VFS map
 * @param {string} vfsPath - VFS path for error messages
 * @throws {Error} If entry is invalid
 */
function validateVFSEntry(entry, vfsPath) {
  // Check entry is an object
  if (typeof entry !== 'object' || entry === null) {
    throw new ErrorConstructor(
      `VFS Error: Invalid VFS entry (not an object): ${vfsPath}\n` +
        `  Entry type: ${typeof entry}\n` +
        '  This may indicate VFS corruption',
    )
  }

  // Check entry has valid type
  const { type } = entry
  if (type !== 'file' && type !== 'directory' && type !== 'symlink') {
    throw new ErrorConstructor(
      `VFS Error: Invalid VFS entry type: ${vfsPath}\n` +
        `  Entry type: ${type}\n` +
        '  Expected: file, directory, or symlink',
    )
  }

  // Check file entries have content buffer
  if (entry.type === 'file' && !BufferIsBuffer(entry.content)) {
    throw new ErrorConstructor(
      `VFS Error: File entry missing or invalid content buffer: ${vfsPath}\n` +
        `  Content type: ${typeof entry.content}\n` +
        '  This may indicate VFS corruption',
    )
  }

  // Check symlink entries have linkTarget
  if (entry.type === 'symlink' && typeof entry.linkTarget !== 'string') {
    throw new ErrorConstructor(
      `VFS Error: Symlink entry missing linkTarget: ${vfsPath}\n` +
        `  linkTarget type: ${typeof entry.linkTarget}\n` +
        '  This may indicate VFS corruption',
    )
  }

  // Check mode is a number
  if (typeof entry.mode !== 'number') {
    throw new ErrorConstructor(
      `VFS Error: Entry mode must be a number: ${vfsPath}\n` +
        `  Mode type: ${typeof entry.mode}\n` +
        '  This may indicate VFS corruption',
    )
  }
}

/**
 * Handle native addon require.
 * Extracts .node file to filesystem and returns real path.
 */
function handleNativeAddon(vfsPath) {
  // Check if exists using combined lookup
  const vfsKey = findVFSKey(vfsPath)
  if (vfsKey === undefined) {
    return
  }

  // Extract to cache (sync for early bootstrap).
  const realPath = mountSync(vfsPath)

  return realPath
}

/**
 * Check if a module path is a native addon.
 */
function isNativeAddon(modulePath) {
  return StringPrototypeEndsWith(modulePath, '.node')
}

/**
 * Mount (extract) a file or directory from VFS to real filesystem synchronously.
 * Returns the path to the extracted file or directory.
 *
 * Supports both single files and recursive directory extraction:
 * - Files: Extracts single file to cache
 * - Directories: Recursively extracts all files and subdirectories
 *
 * Path separators are normalized automatically (backslashes converted to forward slashes).
 * Trailing slashes are optional for directories.
 *
 * Use this for early bootstrap or native addons where async is not available.
 * For large extractions, prefer the async mount() function.
 *
 * @param {string} vfsPath - Path in VFS (e.g., '/snapshot/node_modules/foo/bar.node', '/snapshot/config/app.json', or '/snapshot/assets/')
 * @param {object} options - Options
 * @param {string} options.targetPath - Optional target path (defaults to provider extraction)
 * @returns {string} Path to extracted file or directory on real filesystem
 */
function mountSync(vfsPath, options = {}) {
  // Normalize path separators
  vfsPath = normalizePath(vfsPath)

  // Get VFS prefix (cached for performance)
  const vfsPrefix = getVFSPrefix()
  const vfsBase = vfsPrefix

  // Validate path is within VFS root
  if (
    vfsPath !== vfsBase &&
    !StringPrototypeStartsWith(vfsPath, `${vfsBase}/`)
  ) {
    throw new ErrorConstructor(
      `VFS Error: Invalid VFS path: ${vfsPath}\n` +
        `  Expected path under: ${vfsBase}/\n` +
        `  Current VFS prefix: ${vfsPrefix} (configure via NODE_VFS_PREFIX)`,
    )
  }

  const relativePath = PathRelative(vfsBase, vfsPath)

  // Check for path traversal
  if (StringPrototypeStartsWith(relativePath, '..')) {
    throw new ErrorConstructor(
      'VFS Error: Path traversal detected\n' +
        `  Attempted path: ${vfsPath}\n` +
        `  Resolved to: ${relativePath}\n` +
        '  This is a security violation - paths must stay within VFS root',
    )
  }

  // Get VFS key if exists (single toVFSPath call)
  const vfsKey = findVFSKey(vfsPath)
  if (vfsKey === undefined) {
    throw new ErrorConstructor(
      `VFS Error: File not found in VFS: ${vfsPath}\n` +
        `  Expected path format: ${vfsPrefix}/<path>\n` +
        '  Hint: Use DEBUG=smol:vfs:verbose to list all available VFS files',
    )
  }

  // Check if directory
  const stats = statFromVFS(vfsPath)
  if (stats?.isDirectory()) {
    return mountDirectorySync(vfsPath, relativePath, options)
  }

  // Custom target path
  if (options.targetPath) {
    const content = readFileFromVFS(vfsPath)
    if (!content) {
      throw new ErrorConstructor(
        `VFS Error: Failed to read file from VFS: ${vfsPath}\n` +
          '  File exists in VFS but could not be read\n' +
          '  This may indicate VFS corruption',
      )
    }

    const dirname = PathDirname(options.targetPath)
    try {
      FsMkdirSync(dirname, { recursive: true })
      FsWriteFileSync(options.targetPath, content)
    } catch (err) {
      throw new ErrorConstructor(
        'VFS Error: Failed to extract file to custom path\n' +
          `  VFS path: ${vfsPath}\n` +
          `  Target path: ${options.targetPath}\n` +
          `  Error: ${err.message}`,
      )
    }

    return options.targetPath
  }

  // Use extraction provider
  const provider = getExtractionProvider()

  // Check if already extracted
  const existing = provider.getExtracted(relativePath)
  if (existing) {
    return existing
  }

  // Get VFS entry using already-computed vfsKey (no redundant toVFSPath call)
  const vfs = initVFS()
  const entry = vfs ? MapPrototypeGet(vfs, vfsKey) : undefined

  if (!entry) {
    throw new ErrorConstructor(
      `VFS Error: Failed to read file from VFS: ${vfsPath}\n` +
        '  File exists in VFS but could not be read\n' +
        '  This may indicate VFS corruption',
    )
  }

  // Validate VFSEntry structure
  validateVFSEntry(entry, vfsPath)

  let extractedPath
  try {
    extractedPath = provider.extract(relativePath, entry)
  } catch (err) {
    const config = getVFSConfig()
    const mode = config?.mode || VFS_MODE_IN_MEMORY
    throw new ErrorConstructor(
      'VFS Error: Failed to extract file\n' +
        `  VFS path: ${vfsPath}\n` +
        `  Extraction mode: ${mode}\n` +
        `  Error: ${err.message}\n` +
        '  Hint: Try NODE_VFS_MODE=in-memory if filesystem is read-only',
    )
  }

  return extractedPath
}

/**
 * Mount (extract) a file or directory from VFS to real filesystem asynchronously.
 * Returns a promise that resolves to the path of the extracted file or directory.
 *
 * Supports both single files and recursive directory extraction:
 * - Files: Extracts single file to cache
 * - Directories: Recursively extracts all files and subdirectories (in parallel)
 *
 * Path separators are normalized automatically (backslashes converted to forward slashes).
 * Trailing slashes are optional for directories.
 *
 * This is the preferred method for large extractions (Python, assets) as it does not
 * block the event loop. For early bootstrap or native addons, use mountSync().
 *
 * @param {string} vfsPath - Path in VFS (e.g., '/snapshot/node_modules/foo/bar.node', '/snapshot/config/app.json', or '/snapshot/assets/')
 * @param {object} options - Options
 * @param {string} options.targetPath - Optional target path (defaults to provider extraction)
 * @returns {Promise<string>} Path to extracted file or directory on real filesystem
 */
async function mount(vfsPath, options = {}) {
  // Normalize path separators: VFS paths always use forward slashes (Unix-style)
  // Convert backslashes to forward slashes for cross-platform compatibility
  vfsPath = normalizePath(vfsPath)

  // Get VFS prefix (cached for performance)
  const vfsPrefix = getVFSPrefix()
  const vfsBase = vfsPrefix

  // Validate that vfsPath is within expected VFS root (defense in depth).
  // Allow both paths under vfsBase and mounting vfsBase exactly.
  if (
    vfsPath !== vfsBase &&
    !StringPrototypeStartsWith(vfsPath, `${vfsBase}/`)
  ) {
    throw new ErrorConstructor(
      `VFS Error: Invalid VFS path: ${vfsPath}\n` +
        `  Expected path under: ${vfsBase}/\n` +
        `  Current VFS prefix: ${vfsPrefix} (configure via NODE_VFS_PREFIX)`,
    )
  }

  const relativePath = PathRelative(vfsBase, vfsPath)

  // Additional safety check: ensure no directory traversal.
  if (StringPrototypeStartsWith(relativePath, '..')) {
    throw new ErrorConstructor(
      'VFS Error: Path traversal detected\n' +
        `  Attempted path: ${vfsPath}\n` +
        `  Resolved to: ${relativePath}\n` +
        '  This is a security violation - paths must stay within VFS root',
    )
  }

  // Get VFS key if exists (single toVFSPath call)
  const vfsKey = findVFSKey(vfsPath)
  if (vfsKey === undefined) {
    throw new ErrorConstructor(
      `VFS Error: File not found in VFS: ${vfsPath}\n` +
        `  Expected path format: ${vfsPrefix}/<path>\n` +
        '  Hint: Use DEBUG=smol:vfs:verbose to list all available VFS files',
    )
  }

  // Check if path is a directory
  const stats = statFromVFS(vfsPath)
  if (stats?.isDirectory()) {
    return await mountDirectoryAsync(vfsPath, relativePath, options)
  }

  // Use custom target path if provided (backward compatibility)
  if (options.targetPath) {
    // Custom extraction - read from VFS and write to specified location
    const content = readFileFromVFS(vfsPath)
    if (!content) {
      throw new ErrorConstructor(
        `VFS Error: Failed to read file from VFS: ${vfsPath}\n` +
          '  File exists in VFS but could not be read\n' +
          '  This may indicate VFS corruption',
      )
    }

    const dirname = PathDirname(options.targetPath)
    try {
      await FsMkdir(dirname, { recursive: true })
      await FsWriteFile(options.targetPath, content)
    } catch (err) {
      throw new ErrorConstructor(
        'VFS Error: Failed to extract file to custom path\n' +
          `  VFS path: ${vfsPath}\n` +
          `  Target path: ${options.targetPath}\n` +
          `  Error: ${err.message}`,
      )
    }

    return options.targetPath
  }

  // Use extraction provider (default behavior)
  const provider = getExtractionProvider()

  // Check if already extracted
  const existing = provider.getExtracted(relativePath)
  if (existing) {
    return existing
  }

  // Get VFS entry using already-computed vfsKey (no redundant toVFSPath call)
  const vfs = initVFS()
  const entry = vfs ? MapPrototypeGet(vfs, vfsKey) : undefined

  if (!entry) {
    throw new ErrorConstructor(
      `VFS Error: Failed to read file from VFS: ${vfsPath}\n` +
        '  File exists in VFS but could not be read\n' +
        '  This may indicate VFS corruption',
    )
  }

  // Validate VFSEntry structure
  validateVFSEntry(entry, vfsPath)

  // Extract using provider
  let extractedPath
  try {
    extractedPath = provider.extract(relativePath, entry)
  } catch (err) {
    const config = getVFSConfig()
    const mode = config?.mode || VFS_MODE_IN_MEMORY
    throw new ErrorConstructor(
      'VFS Error: Failed to extract file\n' +
        `  VFS path: ${vfsPath}\n` +
        `  Extraction mode: ${mode}\n` +
        `  Error: ${err.message}\n` +
        '  Hint: Try NODE_VFS_MODE=in-memory if filesystem is read-only',
    )
  }

  return extractedPath
}

/**
 * Recursively extract a directory from VFS to real filesystem asynchronously.
 * @param {string} vfsPath - Directory path in VFS
 * @param {string} relativePath - Relative path from VFS base
 * @param {object} options - Mount options
 * @returns {Promise<string>} Path to extracted directory on real filesystem
 */
async function mountDirectoryAsync(vfsPath, relativePath, options) {
  const provider = getExtractionProvider()

  // Strip trailing slash to prevent double slashes in child paths
  const normalizedVfsPath = StringPrototypeReplace(
    vfsPath,
    TRAILING_SLASHES_REGEX,
    '',
  )
  const normalizedRelativePath = StringPrototypeReplace(
    relativePath,
    TRAILING_SLASHES_REGEX,
    '',
  )

  // Get directory listing
  const entries = readdirFromVFS(normalizedVfsPath, { withFileTypes: true })

  // Extract all files in parallel for better performance
  const results = await SafePromiseAllSettled(
    ArrayPrototypeMap(entries, async entry => {
      const entryVfsPath = `${normalizedVfsPath}/${entry.name}`
      const entryRelativePath = normalizedRelativePath
        ? `${normalizedRelativePath}/${entry.name}`
        : entry.name

      if (entry.isDirectory()) {
        // Recursively extract subdirectory
        await mountDirectoryAsync(entryVfsPath, entryRelativePath, options)
      } else {
        // Extract file using shared helper
        extractFileEntry(provider, entryVfsPath, entryRelativePath)
      }
    }),
  )

  // Check for failures
  const failures = ArrayPrototypeFilter(results, r => r.status === 'rejected')
  if (failures.length) {
    const errors = ArrayPrototypeMap(
      failures,
      f => f.reason?.message || StringConstructor(f.reason || 'Unknown error'),
    )
    throw new ErrorConstructor(
      `VFS Error: Failed to extract ${failures.length} file(s) from directory\n` +
        `  Directory: ${vfsPath}\n` +
        `  Errors:\n${ArrayPrototypeJoin(
          ArrayPrototypeMap(errors, e => `    - ${e}`),
          '\n',
        )}`,
    )
  }

  // Return base directory path
  return getDirectoryOutputPath(provider, normalizedRelativePath)
}

/**
 * Recursively extract a directory from VFS to real filesystem synchronously.
 * @param {string} vfsPath - Directory path in VFS
 * @param {string} relativePath - Relative path from VFS base
 * @param {object} options - Mount options
 * @returns {string} Path to extracted directory on real filesystem
 */
function mountDirectorySync(vfsPath, relativePath, options) {
  const provider = getExtractionProvider()

  // Strip trailing slash to prevent double slashes in child paths
  // Example: '/snapshot/node_modules/foo/' + '/bar.js' would create '//bar.js'
  const normalizedVfsPath = StringPrototypeReplace(
    vfsPath,
    TRAILING_SLASHES_REGEX,
    '',
  )
  const normalizedRelativePath = StringPrototypeReplace(
    relativePath,
    TRAILING_SLASHES_REGEX,
    '',
  )

  // Get directory listing
  const entries = readdirFromVFS(normalizedVfsPath, { withFileTypes: true })

  // Extract all files recursively
  for (let i = 0, { length } = entries; i < length; i += 1) {
    const dirEntry = entries[i]
    const entryVfsPath = `${normalizedVfsPath}/${dirEntry.name}`
    const entryRelativePath = normalizedRelativePath
      ? `${normalizedRelativePath}/${dirEntry.name}`
      : dirEntry.name

    if (dirEntry.isDirectory()) {
      // Recursively extract subdirectory
      mountDirectorySync(entryVfsPath, entryRelativePath, options)
    } else {
      // Extract file using shared helper
      extractFileEntry(provider, entryVfsPath, entryRelativePath)
    }
  }

  // Return base directory path
  return getDirectoryOutputPath(provider, normalizedRelativePath)
}

module.exports = ObjectFreeze({
  getCacheDir,
  handleNativeAddon,
  isNativeAddon,
  mount,
  mountSync,
})
