'use strict'

/**
 * Safe References to Module APIs
 *
 * Captures early references to Buffer, path, fs, process, and crypto methods
 * before any user code can overwrite them. This provides defense-in-depth
 * protection beyond traditional primordials.
 *
 * WHY THIS IS NEEDED:
 * While these aren't prototype methods (not traditional prototype pollution vectors),
 * users can still overwrite module methods:
 *   - Buffer.prototype.slice = () => 'hacked'
 *   - path.join = () => 'hacked'
 *   - fs.readFileSync = () => 'hacked'
 *
 * By capturing references during early bootstrap (before user code runs),
 * we ensure our code uses the original, untampered implementations.
 *
 * USAGE:
 * Instead of:  buffer.slice(0, 10)
 * Use:         BufferPrototypeSlice(buffer, 0, 10)
 *
 * Instead of:  path.join(a, b)
 * Use:         PathJoin(a, b)
 */

// Use primordials for protection against prototype pollution
const {
  Date: DateConstructor,
  FunctionPrototypeBind,
  MathCeil,
  ObjectFreeze,
  StringPrototypeReplace,
  hardenRegExp,
  uncurryThis,
} = primordials

// eslint-disable-next-line n/prefer-node-protocol
const cryptoModule = require('crypto')
// eslint-disable-next-line n/prefer-node-protocol
const fsModule = require('fs')
// eslint-disable-next-line n/prefer-node-protocol
const osModule = require('os')
// eslint-disable-next-line n/prefer-node-protocol
const pathModule = require('path')

// Buffer prototype methods (uncurried for safe invocation)
// uncurryThis transforms prototype methods to accept `this` as first argument:
//   BufferPrototypeSlice(buffer, 0, 10) instead of buffer.slice(0, 10)
const BufferPrototypeSlice = uncurryThis(Buffer.prototype.slice)
const BufferPrototypeToString = uncurryThis(Buffer.prototype.toString)

// Buffer constructor methods
const BufferAlloc = Buffer.alloc
const BufferFrom = Buffer.from

// Path module methods
const PathJoin = pathModule.join
const PathResolve = pathModule.resolve
const PathDirname = pathModule.dirname
const PathBasename = pathModule.basename
const PathRelative = pathModule.relative
const PathSep = pathModule.sep

// Filesystem sync methods
const FsExistsSync = fsModule.existsSync
const FsMkdirSync = fsModule.mkdirSync
const FsMkdtempSync = fsModule.mkdtempSync
const FsWriteFileSync = fsModule.writeFileSync
const FsReadFileSync = fsModule.readFileSync
const FsReaddirSync = fsModule.readdirSync
const FsStatSync = fsModule.statSync
const FsChmodSync = fsModule.chmodSync
const FsCopyFileSync = fsModule.copyFileSync
const FsSymlinkSync = fsModule.symlinkSync
const FsRmSync = fsModule.rmSync

// Filesystem async methods
const FsMkdir = fsModule.promises.mkdir
const FsWriteFile = fsModule.promises.writeFile

// Process properties and methods
const ProcessExecPath = process.execPath
const ProcessPlatform = process.platform
const ProcessArgv = process.argv
const ProcessEnv = process.env
const ProcessVersions = process.versions
const ProcessRawDebug = process._rawDebug

// Process.stderr.write - bound to prevent tampering via process.stderr.write = malicious
const ProcessStderrWrite = FunctionPrototypeBind(
  process.stderr.write,
  process.stderr,
)

// OS module methods
const OsHomedir = osModule.homedir
const OsTmpdir = osModule.tmpdir

// Crypto methods
const CryptoCreateHash = cryptoModule.createHash

// ============================================================================
// Shared Regex Constants
// Hardened regex constants (protected from prototype pollution)
// ============================================================================
const BACKSLASH_REGEX = hardenRegExp(/\\/g)
const TRAILING_SLASHES_REGEX = hardenRegExp(/\/+$/)
const NULL_SUFFIX_REGEX = hardenRegExp(/\0.*$/)
const TRAILING_NEWLINE_REGEX = hardenRegExp(/\n$/)

// ============================================================================
// VFS Binding (shared across bootstrap.js and loader.js)
// ============================================================================
let _vfsBinding
/**
 * Get VFS binding (cached to avoid repeated internalBinding calls)
 * @returns {object|undefined} VFS binding or undefined if not available
 */
function getVFSBinding() {
  if (_vfsBinding === undefined) {
    try {
      _vfsBinding = internalBinding('smol_vfs')
    } catch {
      _vfsBinding = null
    }
  }
  return _vfsBinding || undefined
}

// ============================================================================
// Lazy Loading Factory
// Consistent pattern for lazy-loading modules during bootstrap
// ============================================================================
/**
 * Create a lazy-loading getter for a module.
 * Useful for deferring requires during early bootstrap.
 * @param {string} modulePath - Module path to require
 * @returns {function} Getter that returns the cached module
 */
function createLazyLoader(modulePath) {
  let cache
  return function getLazyModule() {
    if (cache === undefined) {
      cache = require(modulePath)
    }
    return cache
  }
}

// ============================================================================
// Path Normalization
// ============================================================================
/**
 * Normalize path separators (backslashes to forward slashes).
 * VFS paths always use forward slashes (Unix-style).
 * @param {string} filepath - Path to normalize
 * @returns {string} Normalized path with forward slashes
 */
function normalizePath(filepath) {
  return StringPrototypeReplace(filepath, BACKSLASH_REGEX, '/')
}

// ============================================================================
// Shared Stat/Dirent Factory Functions
// Pre-defined functions to avoid recreating on every stat() or readdir() call
// ============================================================================

// Shared Date instance for stat timestamps (all VFS files have epoch time)
const ZERO_DATE = new DateConstructor(0)

// Stat method implementations (shared across all stat objects)
const statIsFile = isDir => () => !isDir
const statIsDirectory = isDir => () => isDir
const statFalse = () => false

/**
 * Create a stat-like object for VFS entries.
 * Uses shared function references to avoid recreating functions on each call.
 * @param {boolean} isDir - Whether entry is a directory
 * @param {number} size - File size in bytes
 * @param {number} mode - File permissions
 * @returns {object} Stat-like object
 */
function createStatObject(isDir, size, mode) {
  return {
    isFile: statIsFile(isDir),
    isDirectory: statIsDirectory(isDir),
    isBlockDevice: statFalse,
    isCharacterDevice: statFalse,
    isFIFO: statFalse,
    isSocket: statFalse,
    isSymbolicLink: statFalse,
    size,
    mode,
    dev: 0,
    ino: 0,
    nlink: 1,
    uid: 0,
    gid: 0,
    rdev: 0,
    blksize: 512,
    blocks: MathCeil(size / 512),
    atimeMs: 0,
    mtimeMs: 0,
    ctimeMs: 0,
    birthtimeMs: 0,
    atime: ZERO_DATE,
    mtime: ZERO_DATE,
    ctime: ZERO_DATE,
    birthtime: ZERO_DATE,
  }
}

/**
 * Create a dirent-like object for VFS directory entries.
 * Uses shared function references to avoid recreating functions on each call.
 * @param {string} name - Entry name
 * @param {boolean} isDir - Whether entry is a directory
 * @returns {object} Dirent-like object
 */
function createDirentObject(name, isDir) {
  return {
    name,
    isFile: statIsFile(isDir),
    isDirectory: statIsDirectory(isDir),
    isBlockDevice: statFalse,
    isCharacterDevice: statFalse,
    isFIFO: statFalse,
    isSocket: statFalse,
    isSymbolicLink: statFalse,
  }
}

module.exports = ObjectFreeze({
  // Buffer
  BufferPrototypeSlice,
  BufferPrototypeToString,
  BufferAlloc,
  BufferFrom,

  // Path
  PathJoin,
  PathResolve,
  PathDirname,
  PathBasename,
  PathRelative,
  PathSep,

  // Filesystem (sync)
  FsExistsSync,
  FsMkdirSync,
  FsMkdtempSync,
  FsWriteFileSync,
  FsReadFileSync,
  FsReaddirSync,
  FsStatSync,
  FsChmodSync,
  FsCopyFileSync,
  FsSymlinkSync,
  FsRmSync,

  // Filesystem (async)
  FsMkdir,
  FsWriteFile,

  // Process
  ProcessExecPath,
  ProcessPlatform,
  ProcessArgv,
  ProcessEnv,
  ProcessVersions,
  ProcessRawDebug,
  ProcessStderrWrite,

  // OS
  OsHomedir,
  OsTmpdir,

  // Crypto
  CryptoCreateHash,

  // Shared Regex Constants
  BACKSLASH_REGEX,
  TRAILING_SLASHES_REGEX,
  NULL_SUFFIX_REGEX,
  TRAILING_NEWLINE_REGEX,

  // Shared Factory Functions
  createStatObject,
  createDirentObject,

  // VFS Binding
  getVFSBinding,

  // Lazy Loading
  createLazyLoader,

  // Path Normalization
  normalizePath,
})
