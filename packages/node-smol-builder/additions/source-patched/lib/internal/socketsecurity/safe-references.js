'use strict'

// Documentation: docs/additions/lib/internal/socketsecurity/safe-references.js.md

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
// eslint-disable-next-line n/prefer-node-protocol
const netModule = require('net')
// eslint-disable-next-line n/prefer-node-protocol
const streamModule = require('stream')
// eslint-disable-next-line n/prefer-node-protocol
const tlsModule = require('tls')
// eslint-disable-next-line n/prefer-node-protocol
const eventsModule = require('events')
// http2 loaded via lazy wrapper to avoid bootstrap ordering issue
// (http2 → debuglog → testEnabled, not available during early bootstrap).
const http2Refs = require('internal/socketsecurity/http2-refs')
// eslint-disable-next-line n/prefer-node-protocol
const utilModule = require('util')
// eslint-disable-next-line n/prefer-node-protocol
const zlibModule = require('zlib')

// Native type checks (direct V8 binding - faster than util.types)
let _typesBinding
function getTypesBinding() {
  if (!_typesBinding) _typesBinding = internalBinding('types')
  return _typesBinding
}

// Capture Buffer constructor early for safe reference
const BufferCtor = Buffer

// Buffer prototype methods (uncurried for safe invocation)
// uncurryThis transforms prototype methods to accept `this` as first argument:
//   BufferPrototypeSlice(buffer, 0, 10) instead of buffer.slice(0, 10)
const BufferPrototypeSlice = uncurryThis(BufferCtor.prototype.slice)
const BufferPrototypeToString = uncurryThis(BufferCtor.prototype.toString)

// Buffer constructor methods
const BufferAlloc = BufferCtor.alloc
const BufferByteLength = BufferCtor.byteLength
const BufferConcat = BufferCtor.concat
const BufferFrom = BufferCtor.from
// Safe Buffer.isBuffer using captured constructor (same as Buffer.isBuffer implementation)
const BufferIsBuffer = obj => obj instanceof BufferCtor

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

// Filesystem file descriptor sync methods
const FsOpenSync = fsModule.openSync
const FsCloseSync = fsModule.closeSync
const FsReadSync = fsModule.readSync
const FsFstatSync = fsModule.fstatSync

// Filesystem async methods
const FsMkdir = fsModule.promises.mkdir
const FsWriteFile = fsModule.promises.writeFile

// Process properties and methods
const ProcessExecPath = process.execPath
const ProcessPlatform = process.platform
const ProcessArgv = process.argv
const ProcessEnv = process.env
const ProcessVersions = process.versions
const ProcessEmit = FunctionPrototypeBind(process.emit, process)
const ProcessRawDebug = process._rawDebug
const ProcessNextTick = process.nextTick

// Process.stderr.write - bound to prevent tampering via process.stderr.write = malicious
const ProcessStderrWrite = FunctionPrototypeBind(
  process.stderr.write,
  process.stderr,
)

// Timer functions - captured early to prevent tampering
const SetInterval = setInterval
const ClearInterval = clearInterval
const SetTimeout = setTimeout
const ClearTimeout = clearTimeout

// OS module methods
const OsHomedir = osModule.homedir
const OsTmpdir = osModule.tmpdir

// Crypto methods
const CryptoCreateHash = cryptoModule.createHash

// Net module methods
const NetCreateServer = netModule.createServer

// Stream module classes
const StreamReadable = streamModule.Readable

// TLS module methods
const TlsCreateServer = tlsModule.createServer

// Events module
const EventsEventEmitter = eventsModule.EventEmitter

// HTTP/2 module methods
function Http2CreateSecureServer(...args) {
  return http2Refs.createSecureServer(...args)
}

// Util module methods
const UtilPromisify = utilModule.promisify

// Zlib methods
const GunzipSync = zlibModule.gunzipSync
const ZlibBrotliCompress = zlibModule.brotliCompress
const ZlibGzip = zlibModule.gzip
const ZlibConstants = zlibModule.constants

// Native type checks (direct V8 binding - faster than util.types wrapper)
// isPromise only returns true for real Promises, not thenables
// Lazy: deferred to first call to avoid eager internalBinding('types')
function InternalUtilTypesIsPromise(value) {
  return getTypesBinding().isPromise(value)
}

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
    _vfsBinding = internalBinding('smol_vfs')
  }
  return _vfsBinding
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
const statTrue = () => true

/**
 * Create a stat-like object for VFS entries.
 * Uses shared function references to avoid recreating functions on each call.
 * @param {boolean} isDir - Whether entry is a directory
 * @param {number} size - File size in bytes
 * @param {number} mode - File permissions
 * @returns {object} Stat-like object
 */
// HISTORY: WHY __proto__: null
// Creating objects with `{ __proto__: null }` prevents prototype pollution —
// an attack where malicious input keys like "__proto__" or "constructor" can
// "walk up" the prototype chain and modify Object.prototype for everyone.
// A null-prototype object has no inherited properties at all, so these keys
// are harmless. Node.js adopted this pattern after incidents where
// hasOwnProperty checks could be spoofed by `{ hasOwnProperty: false }`.
// See Node.js issue #31951 and PR #44007 for the hardening effort.
function createStatObject(isDir, size, mode) {
  return {
    __proto__: null,
    atime: ZERO_DATE,
    atimeMs: 0,
    birthtime: ZERO_DATE,
    birthtimeMs: 0,
    blksize: 512,
    blocks: MathCeil(size / 512),
    ctime: ZERO_DATE,
    ctimeMs: 0,
    dev: 0,
    gid: 0,
    ino: 0,
    isBlockDevice: statFalse,
    isCharacterDevice: statFalse,
    isDirectory: statIsDirectory(isDir),
    isFIFO: statFalse,
    isFile: statIsFile(isDir),
    isSocket: statFalse,
    isSymbolicLink: statFalse,
    mode,
    mtime: ZERO_DATE,
    mtimeMs: 0,
    nlink: 1,
    rdev: 0,
    size,
    uid: 0,
  }
}

/**
 * Create a stat-like object for VFS symlink entries (lstat behavior).
 * For symlinks, isSymbolicLink() returns true and isFile/isDirectory return false.
 * Uses shared function references to avoid recreating functions on each call.
 * @param {number} size - Link target path length
 * @param {number} mode - File permissions (default 0o777 for symlinks)
 * @returns {object} Stat-like object for symlinks
 */
function createSymlinkStatObject(size, mode = 0o120777) {
  return {
    __proto__: null,
    atime: ZERO_DATE,
    atimeMs: 0,
    birthtime: ZERO_DATE,
    birthtimeMs: 0,
    blksize: 512,
    blocks: MathCeil(size / 512),
    ctime: ZERO_DATE,
    ctimeMs: 0,
    dev: 0,
    gid: 0,
    ino: 0,
    isBlockDevice: statFalse,
    isCharacterDevice: statFalse,
    isDirectory: statFalse,
    isFIFO: statFalse,
    isFile: statFalse,
    isSocket: statFalse,
    isSymbolicLink: statTrue,
    mode,
    mtime: ZERO_DATE,
    mtimeMs: 0,
    nlink: 1,
    rdev: 0,
    size,
    uid: 0,
  }
}

/**
 * Create a dirent-like object for VFS directory entries.
 * Uses shared function references to avoid recreating functions on each call.
 * @param {string} name - Entry name
 * @param {boolean} isDir - Whether entry is a directory
 * @param {boolean} isSymlink - Whether entry is a symlink
 * @returns {object} Dirent-like object
 */
function createDirentObject(name, isDir, isSymlink = false) {
  return {
    __proto__: null,
    isBlockDevice: statFalse,
    isCharacterDevice: statFalse,
    isDirectory: isSymlink ? statFalse : statIsDirectory(isDir),
    isFIFO: statFalse,
    isFile: isSymlink ? statFalse : statIsFile(isDir),
    isSocket: statFalse,
    isSymbolicLink: isSymlink ? statTrue : statFalse,
    name,
  }
}

module.exports = ObjectFreeze({
  // Buffer
  BufferPrototypeSlice,
  BufferPrototypeToString,
  BufferAlloc,
  BufferByteLength,
  BufferConcat,
  BufferFrom,
  BufferIsBuffer,

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

  // Filesystem file descriptor (sync)
  FsOpenSync,
  FsCloseSync,
  FsReadSync,
  FsFstatSync,

  // Filesystem (async)
  FsMkdir,
  FsWriteFile,

  // Process
  ProcessEmit,
  ProcessExecPath,
  ProcessPlatform,
  ProcessArgv,
  ProcessEnv,
  ProcessVersions,
  ProcessRawDebug,
  ProcessNextTick,
  ProcessStderrWrite,

  // Timers
  SetInterval,
  ClearInterval,
  SetTimeout,
  ClearTimeout,

  // OS
  OsHomedir,
  OsTmpdir,

  // Crypto
  CryptoCreateHash,

  // Net
  NetCreateServer,

  // Stream
  StreamReadable,

  // TLS
  TlsCreateServer,

  // Events
  EventsEventEmitter,

  // HTTP/2
  Http2CreateSecureServer,

  // Util
  UtilPromisify,

  // Zlib
  GunzipSync,
  ZlibBrotliCompress,
  ZlibGzip,
  ZlibConstants,

  // Native type checks (direct V8 binding)
  InternalUtilTypesIsPromise,

  // Shared Regex Constants
  BACKSLASH_REGEX,
  TRAILING_SLASHES_REGEX,
  NULL_SUFFIX_REGEX,
  TRAILING_NEWLINE_REGEX,

  // Shared Factory Functions
  createStatObject,
  createSymlinkStatObject,
  createDirentObject,

  // VFS Binding
  getVFSBinding,

  // Lazy Loading
  createLazyLoader,

  // Path Normalization
  normalizePath,
})
