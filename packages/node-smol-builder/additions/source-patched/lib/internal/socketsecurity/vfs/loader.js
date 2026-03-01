'use strict'

/**
 * Virtual Filesystem (VFS) Loader
 *
 * Initializes the VFS from CUSTOM_VFS_BLOB and patches fs module
 * to transparently read from the embedded archive.
 *
 * Bootstrap-safe: Uses pure JS TAR parser with no external dependencies.
 * VFS blobs can be uncompressed TAR (.tar) or gzip-compressed TAR (.tgz/.tar.gz).
 */

// Use primordials for protection against prototype pollution
const {
  ArrayPrototypeIncludes,
  ArrayPrototypeMap,
  Error: ErrorConstructor,
  MapPrototypeForEach,
  MapPrototypeGet,
  MapPrototypeHas,
  ObjectFreeze,
  SafeMap,
  StringPrototypeCharCodeAt,
  StringPrototypeIncludes,
  StringPrototypeReplace,
  StringPrototypeSlice,
  StringPrototypeStartsWith,
} = primordials

const {
  BufferFrom,
  BufferPrototypeToString,
  ProcessEnv,
  ProcessExecPath,
  TRAILING_SLASHES_REGEX,
  createDirentObject,
  createLazyLoader,
  createStatObject,
  getVFSBinding,
  normalizePath,
} = require('internal/socketsecurity/safe-references')
// Use pure JS parser (bootstrap-safe, no external dependencies)
const {
  createDebug,
  isDebugEnabled,
} = require('internal/socketsecurity/smol/debug')
const {
  VFS_DIRECTORY_MARKER,
  getContent,
  getDirectoryListing,
  getMode,
  isDirectory,
} = require('internal/socketsecurity/vfs/tar_parser')

const debug = createDebug('smol:vfs')
const debugVerbose = createDebug('smol:vfs:verbose')

// VFS extraction modes
// Extract to RAM (default, works in read-only fs)
const VFS_MODE_IN_MEMORY = 'in-memory'
// Extract to disk cache
const VFS_MODE_ON_DISK = 'on-disk'
// Compatibility mode, no extraction
const VFS_MODE_COMPAT = 'compat'

// Lazy-load gzip support to avoid early zlib dependency
const getParseAutoModule = createLazyLoader(
  'internal/socketsecurity/vfs/tar_gzip',
)
function getParseAuto() {
  return getParseAutoModule().parseAuto
}

let vfsCache
let vfsInitialized = false
let vfsConfig
// Cached VFS prefix for hot-path performance (avoid repeated getVFSConfig calls)
let cachedVfsPrefix

/**
 * Check if file exists in VFS
 * Handles both with and without trailing slash for directories
 * Normalizes backslashes to forward slashes for cross-platform compatibility
 */
function existsInVFS(filepath) {
  return findVFSKey(filepath) !== undefined
}

/**
 * Get VFS base path (executable path)
 */
function getVFSBasePath() {
  return ProcessExecPath
}

/**
 * Get VFS prefix (cached for hot-path performance)
 * @returns {string} VFS prefix (e.g., '/snapshot')
 */
function getVFSPrefix() {
  if (cachedVfsPrefix === undefined) {
    const config = getVFSConfig()
    cachedVfsPrefix = config?.prefix || '/snapshot'
  }
  return cachedVfsPrefix
}

/**
 * Find VFS key for a path, checking with and without trailing slash.
 * Returns the key if found, undefined if path doesn't exist in VFS.
 * @param {string} vfsPath - Path to look up
 * @returns {string|undefined} VFS key if exists, undefined otherwise
 */
function findVFSKey(vfsPath) {
  const vfs = initVFS()
  if (!vfs) {
    return
  }

  const vfsKey = toVFSPath(vfsPath)
  if (vfsKey === undefined) {
    return
  }

  // Check exact match
  if (MapPrototypeHas(vfs, vfsKey)) {
    return vfsKey
  }

  // Check if ends with '/' using charCodeAt (ASCII 47 = '/')
  const len = vfsKey.length
  const endsWithSlash =
    len > 0 && StringPrototypeCharCodeAt(vfsKey, len - 1) === 47

  // Try with trailing slash for directories
  const withSlash = endsWithSlash ? vfsKey : `${vfsKey}/`
  if (MapPrototypeHas(vfs, withSlash)) {
    return withSlash
  }

  // Try without trailing slash
  const withoutSlash = endsWithSlash
    ? StringPrototypeSlice(vfsKey, 0, -1)
    : vfsKey
  if (withoutSlash !== vfsKey && MapPrototypeHas(vfs, withoutSlash)) {
    return withoutSlash
  }

  return
}

/**
 * Get VFS configuration
 * @returns {object|undefined} VFS config object or undefined
 */
function getVFSConfig() {
  if (vfsConfig) {
    return vfsConfig
  }

  // If there's no VFS, don't return a config at all
  if (!hasVFS()) {
    return undefined
  }

  // Initialize default configuration
  vfsConfig = {
    // Default extraction mode
    mode: VFS_MODE_IN_MEMORY,
    // Default VFS path prefix (yao-pkg compat)
    prefix: '/snapshot',
  }

  // Read from embedded config blob if available
  // This comes from SmolVfsConfig (mode, source, prefix) serialized during --build-sea
  const vfsBinding = getVFSBinding()
  if (vfsBinding?.getVFSConfig) {
    const embeddedConfig = vfsBinding.getVFSConfig()
    if (embeddedConfig) {
      // Use embedded config as defaults
      if (embeddedConfig.mode) {
        vfsConfig.mode = embeddedConfig.mode
      }
      if (embeddedConfig.prefix) {
        vfsConfig.prefix = embeddedConfig.prefix
      }
      // Store source path if provided (for debugging/reference)
      if (embeddedConfig.source) {
        vfsConfig.source = embeddedConfig.source
      }
    }
  }

  // Check environment variable for custom mode (overrides embedded config)
  const envMode = ProcessEnv.NODE_VFS_MODE
  if (
    envMode &&
    ArrayPrototypeIncludes(
      [VFS_MODE_ON_DISK, VFS_MODE_IN_MEMORY, VFS_MODE_COMPAT],
      envMode,
    )
  ) {
    vfsConfig.mode = envMode
  }

  // Check environment variable for custom prefix (overrides embedded config)
  const envPrefix = ProcessEnv.NODE_VFS_PREFIX
  if (envPrefix) {
    if (!StringPrototypeStartsWith(envPrefix, '/')) {
      throw new ErrorConstructor(
        `Invalid VFS prefix: "${envPrefix}" - prefix must start with a forward slash (e.g., "/snapshot", "/virtual")`,
      )
    }
    if (StringPrototypeIncludes(envPrefix, '..')) {
      throw new ErrorConstructor(
        `Invalid VFS prefix: "${envPrefix}" - path traversal not allowed`,
      )
    }
    if (envPrefix.length > 256) {
      throw new ErrorConstructor(
        `Invalid VFS prefix: "${envPrefix}" - too long (max 256 chars)`,
      )
    }
    // Normalize trailing slashes
    vfsConfig.prefix = StringPrototypeReplace(
      envPrefix,
      TRAILING_SLASHES_REGEX,
      '',
    )
  }

  return vfsConfig
}

// getVFSBinding imported from safe-references (shared with bootstrap.js)

/**
 * Check if VFS is available
 */
function hasVFS() {
  const vfsBinding = getVFSBinding()
  return vfsBinding ? vfsBinding.hasVFSBlob() : false
}

/**
 * Initialize VFS from embedded blob
 */
function initVFS() {
  if (vfsInitialized) {
    return vfsCache
  }

  // Get VFS binding
  const vfsBinding = getVFSBinding()
  if (!vfsBinding || !vfsBinding.hasVFSBlob()) {
    return
  }

  try {
    const vfsBlob = vfsBinding.getVFSBlob()

    if (!vfsBlob) {
      return
    }

    // Socket Security: Support empty VFS (--vfs-empty flag).
    // Empty VFS enables require.resolve without bundled files.
    if (vfsBlob.length === 0) {
      vfsCache = new SafeMap()
      vfsInitialized = true
      debug('Empty VFS enabled (0 entries)')
      return vfsCache
    }

    // Parse TAR structure (auto-detects .tar vs .tgz)
    const vfsBuffer = BufferFrom(vfsBlob)
    const parseAuto = getParseAuto()
    vfsCache = parseAuto(vfsBuffer)

    // Debug logging
    debug(`Initialized with ${vfsCache.size} entries`)
    if (isDebugEnabled('smol:vfs:verbose')) {
      // Use MapPrototypeForEach to avoid Symbol.iterator pollution
      MapPrototypeForEach(vfsCache, (_, vfsPath) => {
        debugVerbose(`  ${vfsPath}`)
      })
    }

    vfsInitialized = true
    return vfsCache
  } catch (error) {
    debug(`Failed to initialize: ${error.message}`)
    return
  }
}

/**
 * Check if a path is within VFS
 */
function isVFSPath(filepath) {
  if (!filepath || typeof filepath !== 'string') {
    return false
  }

  const basePath = getVFSBasePath()
  const normalized = normalizePath(filepath)
  const baseNormalized = normalizePath(basePath)

  return (
    StringPrototypeStartsWith(normalized, `${baseNormalized}/`) ||
    StringPrototypeStartsWith(normalized, `${baseNormalized}\\`)
  )
}

/**
 * Read directory from VFS
 */
function readdirFromVFS(filepath, options) {
  const vfs = initVFS()
  if (!vfs) {
    return
  }

  const vfsPath = toVFSPath(filepath)
  if (vfsPath === undefined) {
    return
  }

  if (!isDirectory(vfs, vfsPath)) {
    const error = new ErrorConstructor(
      `ENOTDIR: not a directory, scandir '${filepath}'\n` +
        `VFS path: ${vfsPath}\n` +
        'Hint: Use DEBUG=smol:vfs:verbose to inspect VFS contents',
    )
    error.code = 'ENOTDIR'
    error.errno = -20
    error.syscall = 'scandir'
    error.path = filepath
    throw error
  }

  const entries = getDirectoryListing(vfs, vfsPath)

  // Handle withFileTypes option
  if (options?.withFileTypes) {
    return ArrayPrototypeMap(entries, name => {
      const fullPath = vfsPath ? `${vfsPath}/${name}` : name
      const isDir = isDirectory(vfs, fullPath)
      return createDirentObject(name, isDir)
    })
  }

  return entries
}

/**
 * Read file from VFS
 */
function readFileFromVFS(filepath, options) {
  const vfs = initVFS()
  if (!vfs) {
    return
  }

  const vfsPath = toVFSPath(filepath)
  if (!vfsPath) {
    return
  }

  const entry = MapPrototypeGet(vfs, vfsPath)
  if (entry === undefined) {
    return
  }

  const content = getContent(entry)

  if (content === VFS_DIRECTORY_MARKER) {
    // Directory
    const error = new ErrorConstructor(
      `EISDIR: illegal operation on a directory, read '${filepath}'\n` +
        `VFS path: ${vfsPath}\n` +
        'Hint: This is a directory, use fs.readdirSync() instead of fs.readFileSync()',
    )
    error.code = 'EISDIR'
    error.errno = -21
    error.syscall = 'read'
    error.path = filepath
    throw error
  }

  // Handle encoding
  if (options?.encoding && options.encoding !== 'buffer') {
    return BufferPrototypeToString(content, options.encoding)
  }

  return content
}

/**
 * Get file stats from VFS
 */
function statFromVFS(filepath) {
  const vfs = initVFS()
  if (!vfs) {
    return
  }

  const vfsPath = toVFSPath(filepath)
  if (!vfsPath) {
    return
  }

  const entry = MapPrototypeGet(vfs, vfsPath)
  if (entry === undefined) {
    return
  }

  const content = getContent(entry)
  const isDir = content === VFS_DIRECTORY_MARKER || isDirectory(vfs, vfsPath)
  const size = isDir ? 0 : content.length

  // Get mode from TAR metadata (or use defaults)
  const mode = getMode(entry) ?? (isDir ? 0o755 : 0o644)

  return createStatObject(isDir, size, mode)
}

/**
 * Convert absolute path to VFS relative path.
 *
 * Supports two path formats:
 * 1. VFS prefix paths (e.g., '/snapshot/node_modules/foo') - user-facing API
 * 2. execPath-relative paths (e.g., '<execPath>/node_modules/foo') - backwards compat
 *
 * Returns path relative to VFS root (e.g., 'node_modules/foo')
 */
function toVFSPath(filepath) {
  const normalized = normalizePath(filepath)

  // Try VFS prefix path first (e.g., /snapshot/node_modules/...)
  // This is the primary format for user-facing APIs like process.smol.mount()
  const vfsPrefix = getVFSPrefix()

  if (StringPrototypeStartsWith(normalized, `${vfsPrefix}/`)) {
    // Remove prefix and return relative path
    // Example: '/snapshot/node_modules/foo' → 'node_modules/foo'
    return StringPrototypeSlice(normalized, vfsPrefix.length + 1)
  }

  // Fall back to process.execPath-relative paths (for backwards compatibility)
  // This path is used by native addon loading and existing code
  const basePath = getVFSBasePath()
  const baseNormalized = normalizePath(basePath)

  if (StringPrototypeStartsWith(normalized, `${baseNormalized}/`)) {
    return StringPrototypeSlice(normalized, baseNormalized.length + 1)
  }

  return
}

module.exports = ObjectFreeze({
  existsInVFS,
  findVFSKey,
  getVFSBasePath,
  getVFSConfig,
  getVFSPrefix,
  hasVFS,
  initVFS,
  isVFSPath,
  readdirFromVFS,
  readFileFromVFS,
  statFromVFS,
  toVFSPath,
  VFS_MODE_COMPAT,
  VFS_MODE_IN_MEMORY,
  VFS_MODE_ON_DISK,
})
