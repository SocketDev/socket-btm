'use strict'

/**
 * Socket Security: Unified VFS API
 *
 * Provides a clean, unified interface to the Virtual File System.
 * Designed for SEA (Single Executable Application) use cases where
 * files are embedded at build time and accessed at runtime.
 *
 * Key differences from Platformatic/node:vfs:
 * - Read-only (files embedded at build time)
 * - Extract-on-demand (no global fs hijacking)
 * - Native addon support (.node file extraction)
 * - TAR archive format (with optional gzip)
 */

const {
  ArrayPrototypeJoin,
  ArrayPrototypePush,
  Error: ErrorCtor,
  ErrorCaptureStackTrace,
  JSONParse,
  MapPrototypeDelete,
  MapPrototypeForEach,
  MapPrototypeGet,
  MapPrototypeHas,
  MapPrototypeSet,
  MathMin,
  ObjectFreeze,
  ObjectSetPrototypeOf,
  SafeMap,
  StringPrototypeEndsWith,
  StringPrototypeStartsWith,
} = primordials

const {
  BufferAlloc,
  BufferFrom,
  BufferPrototypeSlice,
  FsCloseSync,
  FsFstatSync,
  FsOpenSync,
  FsReadSync,
  ProcessExecPath,
  createStatObject,
  getVFSBinding,
  normalizePath,
} = require('internal/socketsecurity/safe-references')

const {
  VFS_DIRECTORY_MARKER,
  getContent,
  getMode,
  isDirectory,
} = require('internal/socketsecurity/vfs/tar_parser')

const {
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
  readFileFromVFS,
  readdirFromVFS,
  statFromVFS,
  toVFSPath,
} = require('internal/socketsecurity/vfs/loader')

const {
  getCacheStats,
  mount,
  mountSync,
  handleNativeAddon,
  isNativeAddon,
} = require('internal/socketsecurity/smol/mount')

// Stream.Readable from safe-references (captured early, unmodified)
const {
  StreamReadable: Readable,
} = require('internal/socketsecurity/safe-references')
function getReadable() {
  return Readable
}

// Map of real FD -> { vfsPath, realPath } for tracking VFS-opened files
const vfsOpenFiles = new SafeMap()

// Maximum symlink recursion depth (security limit to prevent infinite loops)
// Matches uvwasi's UVWASI__MAX_SYMLINK_FOLLOWS
const MAX_SYMLINK_DEPTH = 32

const ErrorProto = ErrorCtor.prototype

/**
 * VFS Error class for consistent error handling.
 */
class VFSError extends ErrorCtor {
  constructor(message, options) {
    super(message)
    this.name = 'VFSError'
    // Use safe property access to prevent prototype pollution
    const code = options?.code
    const path = options?.path
    const syscall = options?.syscall
    this.code = code !== undefined ? code : 'ERR_VFS'
    if (path !== undefined) {
      this.path = path
    }
    if (syscall !== undefined) {
      this.syscall = syscall
    }
    ErrorCaptureStackTrace(this, VFSError)
  }
}

ObjectSetPrototypeOf(VFSError.prototype, ErrorProto)
ObjectSetPrototypeOf(VFSError, ErrorCtor)

/**
 * Create ENOENT error for missing files with helpful context.
 * @param {string} syscall - System call name
 * @param {string} path - The requested path
 * @param {object} [debug] - Optional debug info from findVFSKey
 */
function createENOENT(syscall, path, debug) {
  const vfsPrefix = getVFSPrefix()
  let message = `ENOENT: no such file or directory, ${syscall} '${path}'`

  // Always include VFS context for easier debugging
  message += `\n  VFS prefix: ${vfsPrefix}`

  // Add debug info if available
  if (debug?.attemptedKeys?.length > 0) {
    message += `\n  Attempted keys: ${ArrayPrototypeJoin(debug.attemptedKeys, ', ')}`
    message += `\n  VFS entries: ${debug.vfsSize}`
  }

  // Add helpful hints
  if (!StringPrototypeStartsWith(path, vfsPrefix)) {
    message += `\n  Hint: Path should start with '${vfsPrefix}/' for VFS access`
  }
  message += '\n  Hint: Use DEBUG=smol:vfs:verbose to list all VFS contents'

  const err = new VFSError(message, { code: 'ENOENT', path, syscall })
  err.errno = -2
  return err
}

/**
 * Create EISDIR error for directory operations on files.
 */
function createEISDIR(syscall, path) {
  const err = new VFSError(
    `EISDIR: illegal operation on a directory, ${syscall} '${path}'`,
    { code: 'EISDIR', path, syscall },
  )
  err.errno = -21
  return err
}

/**
 * Create ENOTDIR error for file operations on directories.
 */
function createENOTDIR(syscall, path) {
  const err = new VFSError(`ENOTDIR: not a directory, ${syscall} '${path}'`, {
    code: 'ENOTDIR',
    path,
    syscall,
  })
  err.errno = -20
  return err
}

/**
 * Normalize a VFS path (add prefix if needed).
 * @param {string} filepath - Path to normalize
 * @returns {string} Normalized path with VFS prefix
 */
function normalizeVFSPath(filepath) {
  const normalized = normalizePath(filepath)
  const prefix = getVFSPrefix()

  // Already has prefix
  if (StringPrototypeStartsWith(normalized, `${prefix}/`)) {
    return normalized
  }

  // Relative path - add prefix
  if (!StringPrototypeStartsWith(normalized, '/')) {
    return `${prefix}/${normalized}`
  }

  // Absolute path without prefix - could be execPath-relative
  return normalized
}

// ============================================================================
// Synchronous File Operations
// ============================================================================

/**
 * Check if a file exists in the VFS.
 * @param {string} filepath - Path to check
 * @returns {boolean} True if file exists
 */
function existsSync(filepath) {
  return existsInVFS(normalizeVFSPath(filepath))
}

/**
 * Read a file from VFS.
 * @param {string} filepath - Path to read
 * @param {object|string} options - Encoding or options object
 * @returns {Buffer|string} File contents
 * @throws {VFSError} If file not found or is a directory
 */
function readFileSync(filepath, options) {
  const normalized = normalizeVFSPath(filepath)
  const result = readFileFromVFS(
    normalized,
    typeof options === 'string' ? { encoding: options } : options,
  )

  if (result === undefined) {
    throw createENOENT('open', filepath)
  }

  return result
}

/**
 * Get file stats from VFS.
 * @param {string} filepath - Path to stat
 * @param {object} options - Options (bigint support, etc.)
 * @returns {object} Stats object
 * @throws {VFSError} If file not found
 */
function statSync(filepath, options) {
  const normalized = normalizeVFSPath(filepath)
  const result = statFromVFS(normalized)

  if (result === undefined) {
    throw createENOENT('stat', filepath)
  }

  return result
}

/**
 * Get file stats without following symlinks.
 * @param {string} filepath - Path to stat
 * @param {object} options - Options
 * @returns {object} Stats object
 * @throws {VFSError} If file not found
 */
function lstatSync(filepath, options) {
  // For now, same as stat (TAR symlinks are stored as entries)
  return statSync(filepath, options)
}

/**
 * Read directory contents from VFS.
 * @param {string} filepath - Directory path
 * @param {object} options - Options (withFileTypes, etc.)
 * @returns {string[]|Dirent[]} Directory entries
 * @throws {VFSError} If directory not found
 */
function readdirSync(filepath, options) {
  const normalized = normalizeVFSPath(filepath)
  const result = readdirFromVFS(normalized, options)

  if (result === undefined) {
    throw createENOENT('scandir', filepath)
  }

  return result
}

/**
 * Check file accessibility.
 * @param {string} filepath - Path to check
 * @param {number} mode - Access mode (default F_OK)
 * @throws {VFSError} If file not accessible or write access requested
 */
function accessSync(filepath, mode = 0) {
  const normalized = normalizeVFSPath(filepath)

  if (!existsInVFS(normalized)) {
    throw createENOENT('access', filepath)
  }

  // VFS is read-only, so write checks always fail (W_OK = 2)
  if (mode & 2) {
    const err = new VFSError(
      `EROFS: read-only file system, access '${filepath}'`,
      { code: 'EROFS', path: filepath, syscall: 'access' },
    )
    err.errno = -30
    throw err
  }
}

/**
 * Get real path (resolves symlinks).
 * @param {string} filepath - Path to resolve
 * @param {object} options - Options
 * @param {number} [_depth=0] - Internal: current recursion depth (for symlink loop detection)
 * @returns {string} Resolved path
 * @throws {VFSError} If path not found or symlink loop detected
 */
function realpathSync(filepath, options, _depth = 0) {
  // Symlink loop/depth protection (0-indexed, so >= enforces exactly MAX_SYMLINK_DEPTH levels)
  if (_depth >= MAX_SYMLINK_DEPTH) {
    const err = new VFSError(
      `ELOOP: too many levels of symbolic links, realpath '${filepath}'`,
      { code: 'ELOOP', path: filepath, syscall: 'realpath' },
    )
    err.errno = -40
    throw err
  }

  const normalized = normalizeVFSPath(filepath)

  // Check if exists and get entry in single lookup
  const debug = { __proto__: null }
  const result = findVFSEntry(normalized, debug)
  if (result === undefined) {
    throw createENOENT('realpath', filepath, debug)
  }

  const { vfsKey, entry } = result
  if (entry && entry.type === 'symlink' && entry.linkTarget) {
    // Resolve symlink target with incremented depth
    const prefix = getVFSPrefix()
    const targetPath = `${prefix}/${entry.linkTarget}`
    return realpathSync(targetPath, options, _depth + 1)
  }

  // Return normalized path with prefix
  const prefix = getVFSPrefix()
  return `${prefix}/${vfsKey}`
}

/**
 * Read symlink target.
 * @param {string} filepath - Symlink path
 * @param {object} options - Options
 * @returns {string} Link target
 * @throws {VFSError} If not a symlink or not found
 */
function readlinkSync(filepath, options) {
  const normalized = normalizeVFSPath(filepath)

  // Find entry in single lookup
  const debug = { __proto__: null }
  const result = findVFSEntry(normalized, debug)
  if (result === undefined) {
    throw createENOENT('readlink', filepath, debug)
  }

  const { entry } = result
  if (!entry || entry.type !== 'symlink') {
    const err = new VFSError(
      `EINVAL: invalid argument, readlink '${filepath}'`,
      { code: 'EINVAL', path: filepath, syscall: 'readlink' },
    )
    err.errno = -22
    throw err
  }

  return entry.linkTarget
}

// ============================================================================
// File Descriptor Operations (using real FDs via extraction)
// ============================================================================

/**
 * Check if a file descriptor was opened via VFS.
 * @param {number} fd - File descriptor
 * @returns {boolean} True if opened via VFS
 */
function isVfsFd(fd) {
  return typeof fd === 'number' && MapPrototypeHas(vfsOpenFiles, fd)
}

/**
 * Open a VFS file and return a real file descriptor.
 * Extracts the file to the filesystem first, then opens with real FsOpenSync.
 *
 * @param {string} filepath - Path to open (VFS path)
 * @param {string|number} flags - Open flags (only read modes supported)
 * @param {number} mode - File mode (ignored for read-only VFS)
 * @returns {number} Real file descriptor
 * @throws {VFSError} If file not found or invalid flags
 */
function openSync(filepath, flags = 'r', mode) {
  // Only read modes supported for VFS (it's read-only)
  const flagStr = typeof flags === 'number' ? 'r' : flags
  if (
    flagStr !== 'r' &&
    flagStr !== 'r+' &&
    flagStr !== 'rs' &&
    flagStr !== 'rs+'
  ) {
    const err = new VFSError(
      `EROFS: read-only file system, open '${filepath}'`,
      { code: 'EROFS', path: filepath, syscall: 'open' },
    )
    err.errno = -30
    throw err
  }

  const normalized = normalizeVFSPath(filepath)

  // Single lookup - statFromVFS returns undefined if not found
  const stats = statFromVFS(normalized)
  if (!stats) {
    throw createENOENT('open', filepath)
  }
  if (stats.isDirectory()) {
    throw createEISDIR('open', filepath)
  }

  // Extract to real filesystem (uses existing extraction provider)
  const realPath = mountSync(normalized)

  // Open with FsOpenSync - returns real kernel FD
  const fd = FsOpenSync(realPath, flags, mode)

  // Track that this FD came from VFS (for debugging/introspection)
  MapPrototypeSet(vfsOpenFiles, fd, {
    __proto__: null,
    vfsPath: filepath,
    realPath,
  })

  return fd
}

/**
 * Close a file descriptor.
 * Works for both VFS-opened and regular FDs.
 *
 * @param {number} fd - File descriptor
 */
function closeSync(fd) {
  // Close the real FD
  FsCloseSync(fd)

  // Remove from tracking if it was a VFS file
  if (MapPrototypeHas(vfsOpenFiles, fd)) {
    MapPrototypeDelete(vfsOpenFiles, fd)
  }
}

/**
 * Read from a file descriptor.
 * Works for both VFS-opened and regular FDs (delegates to real FsReadSync).
 *
 * @param {number} fd - File descriptor
 * @param {Buffer} buffer - Buffer to read into
 * @param {number} offset - Offset in buffer to start writing
 * @param {number} length - Number of bytes to read
 * @param {number|null} position - Position in file to read from
 * @returns {number} Number of bytes read
 */
function readSync(fd, buffer, offset, length, position) {
  return FsReadSync(fd, buffer, offset, length, position)
}

/**
 * Get stats for an open file descriptor.
 * Works for both VFS-opened and regular FDs (delegates to real FsFstatSync).
 *
 * @param {number} fd - File descriptor
 * @param {object} options - Options
 * @returns {object} Stats object
 */
function fstatSync(fd, options) {
  return FsFstatSync(fd, options)
}

/**
 * Get the original VFS path for a VFS-opened file descriptor.
 * @param {number} fd - File descriptor
 * @returns {string|undefined} VFS path or undefined if not a VFS FD
 */
function getVfsPath(fd) {
  const info = MapPrototypeGet(vfsOpenFiles, fd)
  return info?.vfsPath
}

/**
 * Get the real filesystem path for a VFS-opened file descriptor.
 * @param {number} fd - File descriptor
 * @returns {string|undefined} Real path or undefined if not a VFS FD
 */
function getRealPath(fd) {
  const info = MapPrototypeGet(vfsOpenFiles, fd)
  return info?.realPath
}

// ============================================================================
// Async Wrappers (VFS operations are sync, but API matches fs/promises)
// ============================================================================

/**
 * Async file operations (wrappers over sync for API compatibility).
 */
const promises = {
  __proto__: null,

  async exists(filepath) {
    return existsSync(filepath)
  },

  async readFile(filepath, options) {
    return readFileSync(filepath, options)
  },

  async stat(filepath, options) {
    return statSync(filepath, options)
  },

  async lstat(filepath, options) {
    return lstatSync(filepath, options)
  },

  async readdir(filepath, options) {
    return readdirSync(filepath, options)
  },

  async access(filepath, mode) {
    return accessSync(filepath, mode)
  },

  async realpath(filepath, options) {
    return realpathSync(filepath, options)
  },

  async readlink(filepath, options) {
    return readlinkSync(filepath, options)
  },

  async open(filepath, flags, mode) {
    return openSync(filepath, flags, mode)
  },

  async fstat(fd, options) {
    return fstatSync(fd, options)
  },

  // Convenience methods (async wrappers)
  async readFileAsJSON(filepath) {
    return readFileAsJSON(filepath)
  },

  async readFileAsText(filepath, encoding) {
    return readFileAsText(filepath, encoding)
  },

  async readFileAsBuffer(filepath) {
    return readFileAsBuffer(filepath)
  },

  async readMultiple(filepaths, options) {
    return readMultiple(filepaths, options)
  },
}

// ============================================================================
// Convenience Methods
// ============================================================================

/**
 * Check if a path is a VFS path (starts with VFS prefix).
 * @param {string} filepath - Path to check
 * @returns {boolean} True if path is a VFS path
 */
function isVFSPathExport(filepath) {
  return isVFSPath(filepath)
}

/**
 * Read a file from VFS and parse as JSON.
 * @param {string} filepath - Path to read
 * @returns {any} Parsed JSON content
 * @throws {VFSError} If file not found or invalid JSON
 */
function readFileAsJSON(filepath) {
  const content = readFileSync(filepath, 'utf8')
  try {
    return JSONParse(content)
  } catch (err) {
    const parseErr = new VFSError(
      `Failed to parse JSON: ${filepath} - ${err.message}`,
      { code: 'ERR_VFS_JSON_PARSE', path: filepath },
    )
    throw parseErr
  }
}

/**
 * Read a file from VFS as a UTF-8 string.
 * @param {string} filepath - Path to read
 * @param {string} [encoding='utf8'] - Encoding to use
 * @returns {string} File contents as string
 * @throws {VFSError} If file not found
 */
function readFileAsText(filepath, encoding = 'utf8') {
  return readFileSync(filepath, encoding)
}

/**
 * Read a file from VFS as a Buffer.
 * @param {string} filepath - Path to read
 * @returns {Buffer} File contents as Buffer
 * @throws {VFSError} If file not found
 */
function readFileAsBuffer(filepath) {
  return readFileSync(filepath)
}

/**
 * Read multiple files from VFS.
 * @param {string[]} filepaths - Paths to read
 * @param {object|string} options - Encoding or options object
 * @returns {Array<{path: string, content: Buffer|string, error?: Error}>} Results
 */
function readMultiple(filepaths, options) {
  const len = filepaths.length
  const results = new Array(len)
  for (let i = 0; i < len; i++) {
    const filepath = filepaths[i]
    try {
      const content = readFileSync(filepath, options)
      results[i] = { __proto__: null, path: filepath, content }
    } catch (err) {
      results[i] = {
        __proto__: null,
        path: filepath,
        content: undefined,
        error: err,
      }
    }
  }
  return results
}

/**
 * Get comprehensive VFS stats in one call.
 * @returns {object} Stats object with fileCount, prefix, mode, available
 */
function getVFSStats() {
  const cfg = getVFSConfig()
  if (!cfg) {
    return {
      __proto__: null,
      available: false,
      fileCount: 0,
      prefix: '',
      mode: undefined,
    }
  }

  const vfs = initVFS()
  return {
    __proto__: null,
    available: true,
    fileCount: vfs ? vfs.size : 0,
    prefix: cfg.prefix,
    mode: cfg.mode,
  }
}

// ============================================================================
// VFS-Specific Operations (not in Platformatic)
// ============================================================================

/**
 * List all files in the VFS.
 * @param {object} options - Filter options
 * @param {string} options.prefix - Filter by path prefix
 * @param {string} options.extension - Filter by file extension
 * @returns {string[]} List of file paths
 */
function listFiles(options = {}) {
  const vfs = initVFS()
  if (!vfs) {
    return []
  }

  const files = []
  const { prefix: filterPrefix, extension } = options

  MapPrototypeForEach(vfs, (entry, vfsPath) => {
    // Skip directories (they have VFS_DIRECTORY_MARKER)
    const content = getContent(entry)
    if (content === VFS_DIRECTORY_MARKER) {
      return
    }

    // Apply prefix filter
    if (filterPrefix && !StringPrototypeStartsWith(vfsPath, filterPrefix)) {
      return
    }

    // Apply extension filter
    if (extension && !StringPrototypeEndsWith(vfsPath, extension)) {
      return
    }

    ArrayPrototypePush(files, vfsPath)
  })

  return files
}

/**
 * Get VFS configuration.
 * @returns {object} Configuration object
 */
function config() {
  const cfg = getVFSConfig()
  if (!cfg) {
    return {
      __proto__: null,
      available: false,
    }
  }

  return {
    __proto__: null,
    available: true,
    prefix: cfg.prefix,
    mode: cfg.mode,
  }
}

/**
 * Check if SEA can be built (LIEF support available).
 * @returns {boolean} True if LIEF is available
 */
function canBuildSea() {
  const vfsBinding = getVFSBinding()
  return vfsBinding?.canBuildSea ? vfsBinding.canBuildSea() : false
}

/**
 * Get the VFS prefix path.
 * @returns {string} Prefix (e.g., '/snapshot')
 */
function prefix() {
  return getVFSPrefix()
}

/**
 * Get file count in VFS.
 * @returns {number} Number of entries
 */
function size() {
  const vfs = initVFS()
  return vfs ? vfs.size : 0
}

// ============================================================================
// Stream Support
// ============================================================================

/**
 * Create a readable stream from VFS file.
 * Uses real FD for proper chunked reading instead of buffering entire file.
 * @param {string} filepath - File path
 * @param {object} options - Stream options (start, end, encoding, highWaterMark)
 * @returns {Readable} Readable stream
 */
function createReadStream(filepath, options = {}) {
  const ReadableClass = getReadable()

  const normalized = normalizeVFSPath(filepath)

  // Get stats in single lookup (avoids separate existsInVFS + statFromVFS calls)
  const stats = statFromVFS(normalized)
  if (!stats) {
    throw createENOENT('open', filepath)
  }
  if (stats.isDirectory()) {
    throw createEISDIR('open', filepath)
  }

  const fileSize = stats.size
  const {
    start = 0,
    end = fileSize,
    encoding,
    highWaterMark = 64 * 1024, // 64KB chunks
  } = options

  // Extract to real filesystem and open directly (avoids redundant statFromVFS in openSync)
  const realPath = mountSync(normalized)
  const fd = FsOpenSync(realPath, 'r')
  let position = start
  let destroyed = false

  let stream
  try {
    stream = new ReadableClass({
      highWaterMark,
      encoding,
      read(size) {
        if (destroyed || position >= end) {
          this.push(null)
          return
        }

        // Calculate bytes to read
        const toRead = MathMin(size, end - position)
        const buffer = BufferAlloc(toRead)

        try {
          const bytesRead = FsReadSync(fd, buffer, 0, toRead, position)
          if (bytesRead === 0) {
            this.push(null)
            return
          }

          position += bytesRead
          this.push(
            bytesRead < toRead
              ? BufferPrototypeSlice(buffer, 0, bytesRead)
              : buffer,
          )
        } catch (err) {
          this.destroy(err)
        }
      },
      destroy(err, callback) {
        if (!destroyed) {
          destroyed = true
          try {
            closeSync(fd)
          } catch {
            // Ignore close errors during destroy
          }
        }
        callback(err)
      },
    })
  } catch (err) {
    // Clean up fd if stream construction fails
    try {
      FsCloseSync(fd)
    } catch {
      // Ignore close errors during cleanup
    }
    throw err
  }

  // Add path property for compatibility
  stream.path = filepath

  return stream
}

// ============================================================================
// Module Exports
// ============================================================================

module.exports = ObjectFreeze({
  __proto__: null,
  // Core state
  hasVFS,
  config,
  prefix,
  size,
  canBuildSea,
  MAX_SYMLINK_DEPTH,

  // Sync file operations (fs-compatible)
  existsSync,
  readFileSync,
  statSync,
  lstatSync,
  readdirSync,
  accessSync,
  realpathSync,
  readlinkSync,

  // File descriptor operations (uses real FDs via extraction)
  openSync,
  closeSync,
  readSync,
  fstatSync,
  isVfsFd,
  getVfsPath,
  getRealPath,

  // Async operations (fs/promises compatible)
  promises,

  // Streams
  createReadStream,

  // VFS-specific operations
  listFiles,
  mount,
  mountSync,

  // Native addon support
  handleNativeAddon,
  isNativeAddon,

  // Convenience methods
  isVFSPath: isVFSPathExport,
  readFileAsJSON,
  readFileAsText,
  readFileAsBuffer,
  readMultiple,
  getVFSStats,
  getCacheStats,

  // Error class
  VFSError,

  // Constants
  MODE_COMPAT: VFS_MODE_COMPAT,
  MODE_IN_MEMORY: VFS_MODE_IN_MEMORY,
  MODE_ON_DISK: VFS_MODE_ON_DISK,
})
