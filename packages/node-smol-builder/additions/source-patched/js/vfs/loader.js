/**
 * Virtual Filesystem (VFS) Loader
 *
 * Initializes the VFS from CUSTOM_VFS_BLOB and patches fs module
 * to transparently read from the embedded archive.
 *
 * Bootstrap-safe: Uses pure JS TAR parser with no external dependencies.
 * VFS blobs are expected to be uncompressed TAR archives.
 */

// Use pure JS parser (bootstrap-safe, no external dependencies)
const {
  getDirectoryListing,
  isDirectory,
  parseTar,
} = require('internal/socketsecurity_vfs/tar_parser')

let vfsCache = null
let vfsInitialized = false

/**
 * Get VFS binding (cached)
 * @returns {object|null} VFS binding or null if not available
 */
function getVFSBinding() {
  try {
    // eslint-disable-next-line no-undef
    return internalBinding('smol_vfs')
  } catch {
    return null
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
 * Get VFS base path (executable path)
 */
function getVFSBasePath() {
  return process.execPath
}

/**
 * Initialize VFS from embedded blob
 */
function initVFS() {
  if (vfsInitialized) {
    return vfsCache
  }

  vfsInitialized = true

  // Get VFS binding
  const vfsBinding = getVFSBinding()
  if (!vfsBinding || !vfsBinding.hasVFSBlob()) {
    return null
  }

  try {
    const vfsBlob = vfsBinding.getVFSBlob()

    if (!vfsBlob) {
      return null
    }

    // Parse TAR structure
    const vfsBuffer = Buffer.from(vfsBlob)
    vfsCache = parseTar(vfsBuffer)

    // Debug logging
    if (process.env.NODE_DEBUG_VFS) {
      process._rawDebug(`VFS: Initialized with ${vfsCache.size} entries`)
      if (process.env.NODE_DEBUG_VFS === 'verbose') {
        for (const [path] of vfsCache) {
          process._rawDebug(`  ${path}`)
        }
      }
    }

    return vfsCache
  } catch (error) {
    process._rawDebug('VFS: Failed to initialize:', error.message)
    return null
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
 * Convert absolute path to VFS relative path
 */
function toVFSPath(filepath) {
  const basePath = getVFSBasePath()
  const normalized = filepath.replace(/\\/g, '/')
  const baseNormalized = basePath.replace(/\\/g, '/')

  if (normalized.startsWith(`${baseNormalized}/`)) {
    return normalized.slice(baseNormalized.length + 1)
  }
  if (normalized.startsWith(`${baseNormalized}\\`)) {
    return normalized.slice(baseNormalized.length + 1).replace(/\\/g, '/')
  }

  return null
}

/**
 * Read file from VFS
 */
function readFileFromVFS(filepath, options) {
  const vfs = initVFS()
  if (!vfs) {
    return null
  }

  const vfsPath = toVFSPath(filepath)
  if (!vfsPath) {
    return null
  }

  const content = vfs.get(vfsPath)
  if (content === undefined) {
    return null
  }

  if (content === null) {
    // Directory
    const error = new Error(
      `EISDIR: illegal operation on a directory, read '${filepath}'`,
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
 * Get file stats from VFS
 */
function statFromVFS(filepath) {
  const vfs = initVFS()
  if (!vfs) {
    return null
  }

  const vfsPath = toVFSPath(filepath)
  if (!vfsPath) {
    return null
  }

  const content = vfs.get(vfsPath)
  if (content === undefined) {
    return null
  }

  const isDir = content === null || isDirectory(vfs, vfsPath)
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
 * Read directory from VFS
 */
function readdirFromVFS(filepath, options) {
  const vfs = initVFS()
  if (!vfs) {
    return null
  }

  const vfsPath = toVFSPath(filepath)
  if (vfsPath === null) {
    return null
  }

  if (!isDirectory(vfs, vfsPath)) {
    const error = new Error(`ENOTDIR: not a directory, scandir '${filepath}'`)
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

module.exports = {
  hasVFS,
  initVFS,
  isVFSPath,
  readFileFromVFS,
  existsInVFS,
  statFromVFS,
  readdirFromVFS,
  getVFSBasePath,
}
