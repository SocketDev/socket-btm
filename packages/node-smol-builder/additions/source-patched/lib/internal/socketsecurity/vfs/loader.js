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

// Use pure JS parser (bootstrap-safe, no external dependencies)
const {
  createDebug,
  isDebugEnabled,
} = require('internal/socketsecurity/smol/debug')
const {
  VFS_DIRECTORY_MARKER,
  getDirectoryListing,
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
let parseAutoFn
function getParseAuto() {
  if (!parseAutoFn) {
    parseAutoFn = require('internal/socketsecurity/vfs/tar_gzip').parseAuto
  }
  return parseAutoFn
}

let vfsCache
let vfsInitialized = false
let vfsConfig

/**
 * Check if file exists in VFS
 */
function existsInVFS(filepath) {
  const vfs = initVFS()
  if (!vfs) {
    return false
  }

  const vfsPath = toVFSPath(filepath)
  if (!vfsPath) {
    return false
  }

  return vfs.has(vfsPath)
}

/**
 * Get VFS base path (executable path)
 */
function getVFSBasePath() {
  return process.execPath
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
  const envMode = process.env.NODE_VFS_MODE
  if (
    envMode &&
    [VFS_MODE_ON_DISK, VFS_MODE_IN_MEMORY, VFS_MODE_COMPAT].includes(envMode)
  ) {
    vfsConfig.mode = envMode
  }

  // Check environment variable for custom prefix (overrides embedded config)
  const envPrefix = process.env.NODE_VFS_PREFIX
  if (envPrefix) {
    if (!envPrefix.startsWith('/')) {
      throw new Error(
        `Invalid VFS prefix: "${envPrefix}" - prefix must start with a forward slash (e.g., "/snapshot", "/virtual")`,
      )
    }
    if (envPrefix.includes('..')) {
      throw new Error(
        `Invalid VFS prefix: "${envPrefix}" - path traversal not allowed`,
      )
    }
    if (envPrefix.length > 256) {
      throw new Error(
        `Invalid VFS prefix: "${envPrefix}" - too long (max 256 chars)`,
      )
    }
    // Normalize trailing slashes
    vfsConfig.prefix = envPrefix.replace(/\/+$/, '')
  }

  return vfsConfig
}

/**
 * Get VFS binding (cached)
 * @returns {object|undefined} VFS binding or undefined if not available
 */
function getVFSBinding() {
  try {
    // eslint-disable-next-line no-undef
    return internalBinding('smol_vfs')
  } catch {
    return
  }
}

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
      vfsCache = new Map()
      vfsInitialized = true
      debug('Empty VFS enabled (0 entries)')
      return vfsCache
    }

    // Parse TAR structure (auto-detects .tar vs .tgz)
    const vfsBuffer = Buffer.from(vfsBlob)
    const parseAuto = getParseAuto()
    vfsCache = parseAuto(vfsBuffer)

    // Debug logging
    debug(`Initialized with ${vfsCache.size} entries`)
    if (isDebugEnabled('smol:vfs:verbose')) {
      for (const [path] of vfsCache) {
        debugVerbose(`  ${path}`)
      }
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
  const normalized = filepath.replace(/\\/g, '/')
  const baseNormalized = basePath.replace(/\\/g, '/')

  return (
    normalized.startsWith(`${baseNormalized}/`) ||
    normalized.startsWith(`${baseNormalized}\\`)
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
    const error = new Error(
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
    return entries.map(name => {
      const fullPath = vfsPath ? `${vfsPath}/${name}` : name
      const isDir = isDirectory(vfs, fullPath)
      return {
        name,
        isFile: () => !isDir,
        isDirectory: () => isDir,
        isBlockDevice: () => false,
        isCharacterDevice: () => false,
        isFIFO: () => false,
        isSocket: () => false,
        isSymbolicLink: () => false,
      }
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

  const content = vfs.get(vfsPath)
  if (content === undefined) {
    return
  }

  if (content === VFS_DIRECTORY_MARKER) {
    // Directory
    const error = new Error(
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
    return content.toString(options.encoding)
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

  const content = vfs.get(vfsPath)
  if (content === undefined) {
    return
  }

  const isDir = content === VFS_DIRECTORY_MARKER || isDirectory(vfs, vfsPath)
  const size = isDir ? 0 : content.length

  // Return stat-like object
  return {
    isFile: () => !isDir,
    isDirectory: () => isDir,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isFIFO: () => false,
    isSocket: () => false,
    isSymbolicLink: () => false,
    size,
    mode: isDir ? 0o755 : 0o644,
    dev: 0,
    ino: 0,
    nlink: 1,
    uid: 0,
    gid: 0,
    rdev: 0,
    blksize: 512,
    blocks: Math.ceil(size / 512),
    atimeMs: 0,
    mtimeMs: 0,
    ctimeMs: 0,
    birthtimeMs: 0,
    atime: new Date(0),
    mtime: new Date(0),
    ctime: new Date(0),
    birthtime: new Date(0),
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
 */
function toVFSPath(filepath) {
  const normalized = filepath.replace(/\\/g, '/')

  // Try VFS prefix path first (e.g., /snapshot/node_modules/...)
  // This is the primary format for user-facing APIs like process.smol.mount()
  const config = getVFSConfig()
  const vfsPrefix = config?.prefix || '/snapshot'

  if (normalized.startsWith(`${vfsPrefix}/`)) {
    // Remove prefix and return relative path
    // Example: '/snapshot/node_modules/foo' → 'node_modules/foo'
    return normalized.slice(vfsPrefix.length + 1)
  }

  // Fall back to process.execPath-relative paths (for backwards compatibility)
  // This path is used by native addon loading and existing code
  const basePath = getVFSBasePath()
  const baseNormalized = basePath.replace(/\\/g, '/')

  if (normalized.startsWith(`${baseNormalized}/`)) {
    return normalized.slice(baseNormalized.length + 1)
  }

  return
}

module.exports = {
  existsInVFS,
  getVFSBasePath,
  getVFSConfig,
  hasVFS,
  initVFS,
  isVFSPath,
  readdirFromVFS,
  readFileFromVFS,
  statFromVFS,
  VFS_MODE_COMPAT,
  VFS_MODE_IN_MEMORY,
  VFS_MODE_ON_DISK,
}
