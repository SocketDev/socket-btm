'use strict'

// Documentation: docs/additions/lib/internal/socketsecurity/vfs/loader.js.md

// Use primordials for protection against prototype pollution
const {
  ArrayPrototypeIncludes,
  ArrayPrototypeJoin,
  ArrayPrototypeMap,
  ArrayPrototypePop,
  ArrayPrototypePush,
  Error: ErrorConstructor,
  MapPrototypeForEach,
  MapPrototypeGet,
  MapPrototypeHas,
  MapPrototypeSet,
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
  createSymlinkStatObject,
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
  getFileSize,
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
// Cached normalized base path (avoids repeated normalizePath on execPath)
let cachedBasePathNormalized

// Path normalization cache (hot-path optimization)
// Maps raw filepath → { vfsKey, normalized } to avoid repeated string operations
// Simple bounded map: no LRU overhead since VFS is immutable
const pathCache = new SafeMap()
const PATH_CACHE_MAX_SIZE = 1000

// Stat cache (hot-path optimization since VFS is read-only)
// Maps vfsKey → stat object (simple bounded map, no eviction needed)
const statCache = new SafeMap()
const STAT_CACHE_MAX_SIZE = 1000

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
 * @param {object} [debug] - Optional object to receive debug info about attempted lookups
 * @returns {string|undefined} VFS key if exists, undefined otherwise
 */
function findVFSKey(vfsPath, debug) {
  const vfs = initVFS()
  if (!vfs) {
    return
  }

  const vfsKey = toVFSPath(vfsPath)
  if (vfsKey === undefined) {
    return
  }

  // Fast path: exact match covers >95% of lookups (files).
  // Uses Has for a single lookup without retrieving the value.
  if (MapPrototypeHas(vfs, vfsKey)) {
    return vfsKey
  }

  // Track attempted keys for debugging (only on slow path)
  const attemptedKeys = debug ? [vfsKey] : undefined

  // Check if ends with '/' using charCodeAt (ASCII 47 = '/')
  const len = vfsKey.length
  const endsWithSlash =
    len > 0 && StringPrototypeCharCodeAt(vfsKey, len - 1) === 47

  // Try with trailing slash for directories
  const withSlash = endsWithSlash ? vfsKey : `${vfsKey}/`
  if (attemptedKeys && withSlash !== vfsKey)
    ArrayPrototypePush(attemptedKeys, withSlash)
  if (MapPrototypeHas(vfs, withSlash)) {
    return withSlash
  }

  // Try without trailing slash
  const withoutSlash = endsWithSlash
    ? StringPrototypeSlice(vfsKey, 0, -1)
    : vfsKey
  if (attemptedKeys && withoutSlash !== vfsKey)
    ArrayPrototypePush(attemptedKeys, withoutSlash)
  if (withoutSlash !== vfsKey && MapPrototypeHas(vfs, withoutSlash)) {
    return withoutSlash
  }

  // Check implicit directories (exist as path prefix of other entries)
  if (isDirectory(vfs, vfsKey)) {
    return vfsKey
  }

  // Store debug info if requested
  if (debug) {
    debug.attemptedKeys = attemptedKeys
    debug.vfsSize = vfs.size
  }

  return
}

/**
 * Find VFS key and entry for a path.
 * Returns both the key and entry in a single lookup to avoid redundant Map.get calls.
 * @param {string} vfsPath - Path to look up
 * @param {object} [debug] - Optional object to receive debug info about attempted lookups
 * @returns {{ vfsKey: string, entry: object }|undefined} Object with vfsKey and entry if found
 */
function findVFSEntry(vfsPath, debug) {
  const vfs = initVFS()
  if (!vfs) {
    return
  }

  const vfsKey = toVFSPath(vfsPath)
  if (vfsKey === undefined) {
    return
  }

  // Fast path: exact match covers >95% of lookups (files).
  let entry = MapPrototypeGet(vfs, vfsKey)
  if (entry !== undefined) {
    return { __proto__: null, vfsKey, entry }
  }

  // Track attempted keys for debugging (only on slow path)
  const attemptedKeys = debug ? [vfsKey] : undefined

  // Check if ends with '/' using charCodeAt (ASCII 47 = '/')
  const len = vfsKey.length
  const endsWithSlash =
    len > 0 && StringPrototypeCharCodeAt(vfsKey, len - 1) === 47

  // Try with trailing slash for directories
  const withSlash = endsWithSlash ? vfsKey : `${vfsKey}/`
  if (attemptedKeys && withSlash !== vfsKey)
    ArrayPrototypePush(attemptedKeys, withSlash)
  entry = MapPrototypeGet(vfs, withSlash)
  if (entry !== undefined) {
    return { __proto__: null, vfsKey: withSlash, entry }
  }

  // Try without trailing slash
  const withoutSlash = endsWithSlash
    ? StringPrototypeSlice(vfsKey, 0, -1)
    : vfsKey
  if (attemptedKeys && withoutSlash !== vfsKey)
    ArrayPrototypePush(attemptedKeys, withoutSlash)
  if (withoutSlash !== vfsKey) {
    entry = MapPrototypeGet(vfs, withoutSlash)
    if (entry !== undefined) {
      return { __proto__: null, vfsKey: withoutSlash, entry }
    }
  }

  // Store debug info if requested
  if (debug) {
    debug.attemptedKeys = attemptedKeys
    debug.vfsSize = vfs.size
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
    __proto__: null,
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
    // Note: vfsBlob is an ArrayBuffer from the native binding.
    // Buffer.from(arrayBuffer) creates a zero-copy view (no data copied).
    const vfsBuffer = BufferFrom(vfsBlob)
    debug(`VFS blob size: ${vfsBuffer.length} bytes`)

    // Show first 4 bytes for debugging (without padStart - not in primordials)
    if (vfsBuffer.length >= 4) {
      debug(
        `First 4 bytes: ${vfsBuffer[0]} ${vfsBuffer[1]} ${vfsBuffer[2]} ${vfsBuffer[3]} (hex: 0x${vfsBuffer[0].toString(16)} 0x${vfsBuffer[1].toString(16)})`,
      )
      if (vfsBuffer[0] === 0x1f && vfsBuffer[1] === 0x8b) {
        debug('Gzip magic detected')
      } else {
        debug('Gzip magic NOT detected')
      }
    }

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

    // Proactively cache VFS prefix and base path during init
    // This avoids lazy initialization overhead on first file operation
    getVFSPrefix()
    getNormalizedBasePath()

    return vfsCache
  } catch (error) {
    debug(`Failed to initialize: ${error.message}`)
    return
  }
}

/**
 * Check if a path is within VFS.
 *
 * Supports two path formats:
 * 1. VFS prefix paths (/snapshot/*) — explicit Socket VFS convention
 * 2. execPath-relative paths (<execPath>/*) — Node.js SEA require() resolution
 */
function isVFSPath(filepath) {
  if (!filepath || typeof filepath !== 'string') {
    return false
  }

  const normalized = normalizePath(filepath)

  // Check VFS prefix first (e.g., /snapshot/*)
  const vfsPrefix = getVFSPrefix()
  if (
    normalized === vfsPrefix ||
    StringPrototypeStartsWith(normalized, `${vfsPrefix}/`) ||
    StringPrototypeStartsWith(normalized, `${vfsPrefix}\\`)
  ) {
    return true
  }

  // Then check execPath-relative paths
  const basePath = getVFSBasePath()
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

  const recursive = options?.recursive ?? false
  const withFileTypes = options?.withFileTypes ?? false

  if (recursive) {
    // Recursive mode: collect all entries from subdirectories
    const results = []
    const stack = [{ __proto__: null, dir: vfsPath, prefix: '' }]

    while (stack.length > 0) {
      const { dir, prefix } = ArrayPrototypePop(stack)
      const entries = getDirectoryListing(vfs, dir)

      for (let i = 0, entriesLen = entries.length; i < entriesLen; i++) {
        const name = entries[i]
        const relativePath = prefix ? `${prefix}/${name}` : name
        const fullPath = dir ? `${dir}/${name}` : name
        const entry = MapPrototypeGet(vfs, fullPath)
        const isSymlink = entry?.type === 'symlink'
        const isDir = !isSymlink && isDirectory(vfs, fullPath)

        if (withFileTypes) {
          ArrayPrototypePush(
            results,
            createDirentObject(relativePath, isDir, isSymlink),
          )
        } else {
          ArrayPrototypePush(results, relativePath)
        }

        // Only recurse into real directories (not symlinks to directories)
        if (isDir) {
          // Add subdirectory to stack for traversal
          ArrayPrototypePush(stack, {
            __proto__: null,
            dir: fullPath,
            prefix: relativePath,
          })
        }
      }
    }

    return results
  }

  // Non-recursive mode
  const entries = getDirectoryListing(vfs, vfsPath)

  // Handle withFileTypes option
  if (withFileTypes) {
    return ArrayPrototypeMap(entries, name => {
      const fullPath = vfsPath ? `${vfsPath}/${name}` : name
      const entry = MapPrototypeGet(vfs, fullPath)
      const isSymlink = entry?.type === 'symlink'
      const isDir = !isSymlink && isDirectory(vfs, fullPath)
      return createDirentObject(name, isDir, isSymlink)
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
  if (vfsPath === undefined) {
    return
  }

  const entry = MapPrototypeGet(vfs, vfsPath)
  if (entry === undefined) {
    // Path not in map — check if it's an implicit directory
    if (isDirectory(vfs, vfsPath)) {
      const error = new ErrorConstructor(
        `EISDIR: illegal operation on a directory, read '${filepath}'`,
      )
      error.code = 'EISDIR'
      error.errno = -21
      error.syscall = 'read'
      error.path = filepath
      throw error
    }
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
 * Get file stats from VFS (with bounded caching).
 * VFS is read-only, so stat results are immutable and safe to cache.
 */
function statFromVFS(filepath) {
  const vfs = initVFS()
  if (!vfs) {
    return
  }

  const vfsPath = toVFSPath(filepath)
  if (vfsPath === undefined) {
    return
  }

  // Check stat cache first
  const cachedStat = statCacheGet(vfsPath)
  if (cachedStat !== undefined) {
    return cachedStat
  }

  const entry = MapPrototypeGet(vfs, vfsPath)

  // Handle implicit directories (not stored in map but exist as path prefix)
  if (entry === undefined) {
    if (!isDirectory(vfs, vfsPath)) {
      return
    }
    const stat = createStatObject(true, 0, 0o755)
    statCacheSet(vfsPath, stat)
    return stat
  }

  const isDir = entry.type === 'directory' || isDirectory(vfs, vfsPath)
  // Use getFileSize to avoid materializing lazy content just for stat
  const size = isDir ? 0 : getFileSize(entry)

  // Get mode from TAR metadata (or use defaults)
  const mode = getMode(entry) ?? (isDir ? 0o755 : 0o644)

  const stat = createStatObject(isDir, size, mode)

  // Cache the stat result
  statCacheSet(vfsPath, stat)

  return stat
}

/**
 * Get file stats from VFS without following symlinks (lstat behavior).
 * For symlinks, returns stat with isSymbolicLink() = true.
 * For regular files/directories, behaves the same as statFromVFS.
 */
function lstatFromVFS(filepath) {
  const vfs = initVFS()
  if (!vfs) {
    return
  }

  const vfsPath = toVFSPath(filepath)
  if (vfsPath === undefined) {
    return
  }

  const entry = MapPrototypeGet(vfs, vfsPath)
  if (entry === undefined) {
    // Implicit directory check
    if (isDirectory(vfs, vfsPath)) {
      return createStatObject(true, 0, 0o755)
    }
    return
  }

  // Check if entry is a symlink - return symlink stat without following
  if (entry.type === 'symlink') {
    const linkTargetLength = entry.linkTarget ? entry.linkTarget.length : 0
    return createSymlinkStatObject(linkTargetLength)
  }

  // For non-symlinks, return regular stat
  const isDir = entry.type === 'directory' || isDirectory(vfs, vfsPath)
  // Use getFileSize to avoid materializing lazy content just for stat
  const size = isDir ? 0 : getFileSize(entry)
  const mode = getMode(entry) ?? (isDir ? 0o755 : 0o644)

  return createStatObject(isDir, size, mode)
}

/**
 * Read symlink target from VFS.
 * @param {string} filepath - Path to symlink
 * @returns {string|undefined} Link target or undefined if not found/not a symlink
 */
function readlinkFromVFS(filepath) {
  const vfs = initVFS()
  if (!vfs) {
    return
  }

  const vfsPath = toVFSPath(filepath)
  if (vfsPath === undefined) {
    return
  }

  const entry = MapPrototypeGet(vfs, vfsPath)
  if (entry === undefined) {
    return
  }

  // Return link target only if this is a symlink
  if (entry.type === 'symlink' && entry.linkTarget) {
    return entry.linkTarget
  }

  // Not a symlink - return undefined (caller should throw EINVAL)
  return
}

/**
 * Get normalized base path (cached for hot-path performance).
 * @returns {string} Normalized base path
 */
function getNormalizedBasePath() {
  if (cachedBasePathNormalized === undefined) {
    cachedBasePathNormalized = normalizePath(getVFSBasePath())
  }
  return cachedBasePathNormalized
}

/**
 * Helper to get from path cache (simple bounded map, no LRU overhead).
 * VFS is immutable so cache entries never go stale. Once the cache is
 * full we stop inserting -- the working set is warm enough.
 * @param {string} filepath
 * @returns {object|undefined}
 */
function pathCacheGet(filepath) {
  return MapPrototypeGet(pathCache, filepath)
}

/**
 * Helper to set in path cache (simple bounded map, no eviction).
 * @param {string} filepath
 * @param {object} value
 */
function pathCacheSet(filepath, value) {
  if (pathCache.size < PATH_CACHE_MAX_SIZE) {
    MapPrototypeSet(pathCache, filepath, value)
  }
}

/**
 * Helper to get from stat cache (simple bounded map, no LRU overhead).
 * VFS is immutable so stat results never change.
 * @param {string} vfsKey
 * @returns {object|undefined}
 */
function statCacheGet(vfsKey) {
  return MapPrototypeGet(statCache, vfsKey)
}

/**
 * Helper to set in stat cache (simple bounded map, no eviction).
 * @param {string} vfsKey
 * @param {object} value
 */
function statCacheSet(vfsKey, value) {
  if (statCache.size < STAT_CACHE_MAX_SIZE) {
    MapPrototypeSet(statCache, vfsKey, value)
  }
}

/**
 * Convert absolute path to VFS relative path.
 *
 * Supports two path formats:
 * 1. VFS prefix paths (e.g., '/snapshot/node_modules/foo') - user-facing API
 * 2. execPath-relative paths (e.g., '<execPath>/node_modules/foo') - backwards compat
 *
 * Returns path relative to VFS root (e.g., 'node_modules/foo')
 *
 * Uses bounded caching to avoid repeated string operations on hot paths.
 */
function toVFSPath(filepath) {
  // Check path cache first
  const cached = pathCacheGet(filepath)
  if (cached !== undefined) {
    return cached.vfsKey
  }

  const normalized = normalizePath(filepath)

  // Try VFS prefix path first (e.g., /snapshot/node_modules/...)
  // This is the primary format for user-facing APIs like process.smol.mount()
  const vfsPrefix = getVFSPrefix()

  let vfsKey
  if (normalized === vfsPrefix) {
    // Exact match on VFS root (e.g., '/snapshot' → '')
    vfsKey = ''
  } else if (StringPrototypeStartsWith(normalized, `${vfsPrefix}/`)) {
    // Remove prefix and return relative path
    // Example: '/snapshot/node_modules/foo' → 'node_modules/foo'
    vfsKey = StringPrototypeSlice(normalized, vfsPrefix.length + 1)
  } else {
    // Fall back to process.execPath-relative paths (for backwards compatibility)
    // This path is used by native addon loading and existing code
    const baseNormalized = getNormalizedBasePath()

    if (StringPrototypeStartsWith(normalized, `${baseNormalized}/`)) {
      vfsKey = StringPrototypeSlice(normalized, baseNormalized.length + 1)
    }
  }

  // Cache the result
  pathCacheSet(filepath, {
    __proto__: null,
    vfsKey,
    normalized,
  })

  return vfsKey
}

module.exports = ObjectFreeze({
  __proto__: null,
  VFS_MODE_COMPAT,
  VFS_MODE_IN_MEMORY,
  VFS_MODE_ON_DISK,
  existsInVFS,
  findVFSEntry,
  findVFSKey,
  getVFSBasePath,
  getVFSConfig,
  getVFSPrefix,
  hasVFS,
  initVFS,
  isVFSPath,
  lstatFromVFS,
  readFileFromVFS,
  readdirFromVFS,
  readlinkFromVFS,
  statFromVFS,
  toVFSPath,
})
