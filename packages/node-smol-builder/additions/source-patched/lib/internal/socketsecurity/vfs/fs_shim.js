'use strict'

// Documentation: docs/additions/lib/internal/socketsecurity/vfs/fs_shim.js.md

// Use primordials for protection against prototype pollution
const {
  ArrayFrom,
  ArrayPrototypeIncludes,
  ArrayPrototypePush,
  Error: ErrorConstructor,
  ObjectDefineProperty,
  ObjectFreeze,
  PromiseResolve,
  PromiseReject,
  ReflectApply,
  StringPrototypeSlice,
  StringPrototypeStartsWith,
} = primordials

const {
  createStatObject,
  PathResolve,
  PathSep,
  ProcessEmit,
  ProcessEnv,
  ProcessNextTick,
  ProcessRawDebug,
} = require('internal/socketsecurity/safe-references')
const {
  existsInVFS,
  getVFSPrefix,
  hasVFS,
  isVFSPath,
  lstatFromVFS,
  readFileFromVFS,
  readdirFromVFS,
  readlinkFromVFS,
  statFromVFS,
} = require('internal/socketsecurity/vfs/loader')
const {
  existsInSea,
  isSeaPath,
  readFileFromSea,
  readdirFromSea,
  statFromSea,
} = require('internal/socketsecurity/vfs/sea_path')

/**
 * Fast combined check for whether a path belongs to SEA or VFS.
 * Avoids two separate normalization + prefix check sequences for
 * write operations that only need to know "is this read-only?".
 */
function isVirtualPath(path) {
  return isSeaPath(path) || isVFSPath(path)
}

let shimmedFs

/**
 * SmolProvider state for handler-based fs integration.
 * Handlers are checked at the start of each fs method body.
 * This pattern ensures captured references work correctly.
 */
const smolVfsState = {
  __proto__: null,
  handlers: undefined,
  overlay: false,
  extractDir: undefined,
  extractDirResolved: undefined,
  // Store original functions for handlers that need to merge results
  originalReaddirSync: undefined,
  // Store original functions for overlay path rewriting
  originalReadFileSync: undefined,
  originalExistsSync: undefined,
  originalStatSync: undefined,
  originalLstatSync: undefined,
  originalRealpathSync: undefined,
  originalAccessSync: undefined,
  originalReadlinkSync: undefined,
  originalReadFile: undefined,
  originalStat: undefined,
  originalLstat: undefined,
  originalReaddir: undefined,
  originalRealpath: undefined,
  originalAccess: undefined,
  originalExists: undefined,
  originalReadlink: undefined,
  // Store all original methods for restoration by removeVFSShims
  originalWriteFileSync: undefined,
  originalAppendFileSync: undefined,
  originalUnlinkSync: undefined,
  originalRmdirSync: undefined,
  originalMkdirSync: undefined,
  originalRenameSync: undefined,
  originalCopyFileSync: undefined,
}

/**
 * Create ENOENT error for missing files
 */
function createENOENT(syscall, path) {
  const error = new ErrorConstructor(
    `ENOENT: no such file or directory, ${syscall} '${path}'`,
  )
  error.code = 'ENOENT'
  error.errno = -2
  error.syscall = syscall
  error.path = path
  return error
}

/**
 * Create EROFS error for read-only filesystem operations
 */
function createEROFS(syscall, path) {
  const error = new ErrorConstructor(
    `EROFS: read-only file system, ${syscall} '${path}'`,
  )
  error.code = 'EROFS'
  error.errno = -30
  error.syscall = syscall
  error.path = path
  return error
}

/**
 * Resolve the extraction directory, lazily from the extraction provider if
 * not explicitly configured. /snapshot is an alias for ~/.socket/_dlx/<hash>/
 * — overlay paths always resolve relative to this directory.
 */
function resolveExtractDir() {
  if (smolVfsState.extractDir) {
    return
  }
  // Lazy-resolve from extraction provider's cache dir
  try {
    const { getCacheDir } = require('internal/socketsecurity/smol/mount')
    const cacheDir = getCacheDir()
    if (cacheDir) {
      smolVfsState.extractDir = cacheDir
      smolVfsState.extractDirResolved = PathResolve(cacheDir)
    }
  } catch {
    // mount module not available during early bootstrap — extractDir stays unset
  }
}

/**
 * Rewrite a VFS path to the extraction cache directory.
 * Translates /snapshot/foo/bar.js → ~/.socket/_dlx/<hash>/foo/bar.js
 * @param {string} path - VFS path to rewrite
 * @returns {string|undefined} Rewritten path, or undefined if extractDir unavailable
 */
function rewriteOverlayPath(path) {
  resolveExtractDir()
  const { extractDir, extractDirResolved } = smolVfsState
  if (!extractDir) {
    return undefined
  }
  const vfsPrefix = getVFSPrefix()
  const relative = StringPrototypeSlice(path, vfsPrefix.length)
  // Resolve to prevent path traversal (e.g., /snapshot/../etc/passwd)
  const resolved = PathResolve(extractDir, `.${relative}`)
  // Validate resolved path stays within extractDir
  if (
    resolved !== extractDirResolved &&
    !StringPrototypeStartsWith(resolved, `${extractDirResolved}${PathSep}`)
  ) {
    // Path traversal attempt — do not allow escaping extraction directory
    throw createENOENT('open', path)
  }
  return resolved
}

/**
 * SmolProvider handlers for VFS and SEA paths.
 * Returns undefined to fall through to real fs.
 */
const smolHandlers = {
  __proto__: null,
  // === Sync Methods ===

  readFileSync(path, options) {
    // Check SEA paths first (/sea/*)
    if (isSeaPath(path)) {
      const content = readFileFromSea(path, options)
      if (content !== undefined) {
        return content
      }
    }
    // Then check VFS paths (/snapshot/*)
    if (isVFSPath(path)) {
      const content = readFileFromVFS(path, options)
      if (content !== undefined) {
        return content
      }
      // Non-overlay mode: VFS paths that don't exist in VFS return ENOENT
      if (!smolVfsState.overlay) {
        throw createENOENT('open', path)
      }
      // Overlay mode: rewrite path to extractDir if configured
      const rewritten = rewriteOverlayPath(path)
      if (rewritten && smolVfsState.originalReadFileSync) {
        return ReflectApply(smolVfsState.originalReadFileSync, shimmedFs, [
          rewritten,
          options,
        ])
      }
    }
    return undefined // Fall through to real fs
  },

  existsSync(path) {
    // Check SEA paths first (/sea/*)
    if (isSeaPath(path)) {
      const exists = existsInSea(path)
      if (exists !== undefined) {
        return exists
      }
    }
    // Then check VFS paths (/snapshot/*)
    if (isVFSPath(path)) {
      if (existsInVFS(path)) {
        return true
      }
      // Non-overlay mode: VFS paths not in VFS return false (no fallthrough)
      if (!smolVfsState.overlay) {
        return false
      }
      // Overlay mode: rewrite path to extractDir if configured
      const rewritten = rewriteOverlayPath(path)
      if (rewritten && smolVfsState.originalExistsSync) {
        return ReflectApply(smolVfsState.originalExistsSync, shimmedFs, [
          rewritten,
        ])
      }
    }
    // Special case: VFS prefix path itself (e.g., '/snapshot')
    if (hasVFS() && path === getVFSPrefix()) {
      return true
    }
    return undefined // Fall through to real fs
  },

  statSync(path, _options) {
    // Check SEA paths first (/sea/*)
    if (isSeaPath(path)) {
      const stat = statFromSea(path)
      if (stat !== undefined) {
        return stat
      }
    }
    // Then check VFS paths (/snapshot/*)
    if (isVFSPath(path)) {
      const stat = statFromVFS(path)
      if (stat !== undefined) {
        return stat
      }
      // Non-overlay mode: VFS paths not in VFS return ENOENT
      if (!smolVfsState.overlay) {
        throw createENOENT('stat', path)
      }
      // Overlay mode: rewrite path to extractDir if configured
      const rewritten = rewriteOverlayPath(path)
      if (rewritten && smolVfsState.originalStatSync) {
        return ReflectApply(smolVfsState.originalStatSync, shimmedFs, [
          rewritten,
          _options,
        ])
      }
    }
    // Special case: VFS prefix path itself (e.g., '/snapshot')
    // This enables glob to recognize the VFS mount point as a directory
    if (hasVFS() && path === getVFSPrefix()) {
      return createStatObject(true, 0, 0o755)
    }
    return undefined // Fall through to real fs
  },

  lstatSync(path, _options) {
    // Check SEA paths first (/sea/*)
    if (isSeaPath(path)) {
      const stat = statFromSea(path)
      if (stat !== undefined) {
        return stat
      }
    }
    // Then check VFS paths (/snapshot/*) - returns symlink stat without following
    if (isVFSPath(path)) {
      const stat = lstatFromVFS(path)
      if (stat !== undefined) {
        return stat
      }
      // Non-overlay mode: VFS paths not in VFS return ENOENT
      if (!smolVfsState.overlay) {
        throw createENOENT('lstat', path)
      }
      // Overlay mode: rewrite path to extractDir if configured
      const rewritten = rewriteOverlayPath(path)
      if (rewritten && smolVfsState.originalLstatSync) {
        return ReflectApply(smolVfsState.originalLstatSync, shimmedFs, [
          rewritten,
          _options,
        ])
      }
    }
    // Special case: VFS prefix path itself (e.g., '/snapshot')
    // This enables glob to recognize the VFS mount point as a directory
    if (hasVFS() && path === getVFSPrefix()) {
      return createStatObject(true, 0, 0o755)
    }
    return undefined // Fall through to real fs
  },

  readlinkSync(path, _options) {
    // Check VFS paths (/snapshot/*) - SEA doesn't support symlinks
    if (isVFSPath(path)) {
      const target = readlinkFromVFS(path)
      if (target !== undefined) {
        return target
      }
      // Path exists but not a symlink - throw EINVAL
      if (existsInVFS(path)) {
        const error = new ErrorConstructor(
          `EINVAL: invalid argument, readlink '${path}'`,
        )
        error.code = 'EINVAL'
        error.errno = -22
        error.syscall = 'readlink'
        error.path = path
        throw error
      }
      // Overlay mode: rewrite path to extractDir if configured
      if (smolVfsState.overlay) {
        const rewritten = rewriteOverlayPath(path)
        if (rewritten && smolVfsState.originalReadlinkSync) {
          return ReflectApply(smolVfsState.originalReadlinkSync, shimmedFs, [
            rewritten,
            _options,
          ])
        }
      }
      throw createENOENT('readlink', path)
    }
    return undefined // Fall through to real fs
  },

  readdirSync(path, options) {
    // Check SEA paths first (/sea/*)
    if (isSeaPath(path)) {
      const entries = readdirFromSea(path, options)
      if (entries !== undefined) {
        return entries
      }
    }
    // Then check VFS paths (/snapshot/*)
    if (isVFSPath(path)) {
      const entries = readdirFromVFS(path, options)
      if (entries !== undefined) {
        return entries
      }
      // Non-overlay mode: VFS paths not in VFS return ENOENT
      if (!smolVfsState.overlay) {
        throw createENOENT('scandir', path)
      }
      // Overlay mode: rewrite path to extractDir if configured
      const rewritten = rewriteOverlayPath(path)
      if (rewritten && smolVfsState.originalReaddirSync) {
        return ReflectApply(smolVfsState.originalReaddirSync, shimmedFs, [
          rewritten,
          options,
        ])
      }
    }
    // Special case: VFS prefix path itself (e.g., '/snapshot')
    // Return VFS root entries by passing empty path to readdirFromVFS
    if (hasVFS() && path === getVFSPrefix()) {
      // Create a synthetic VFS path that will map to root
      const syntheticPath = `${path}/`
      const entries = readdirFromVFS(syntheticPath, options)
      if (entries !== undefined) {
        return entries
      }
    }
    // Special case: root directory '/' needs VFS mount point injected
    // This enables glob patterns like '/snapshot/**/*.txt' to work by
    // allowing glob to discover the VFS mount point when traversing from root
    if (path === '/' && hasVFS() && smolVfsState.originalReaddirSync) {
      const vfsPrefix = getVFSPrefix()
      // Extract mount point name (e.g., '/snapshot' → 'snapshot')
      const mountPoint = StringPrototypeSlice(vfsPrefix, 1)
      // Get real filesystem entries
      const realEntries = ArrayFrom(
        smolVfsState.originalReaddirSync('/', options),
      )
      // Add VFS mount point if not already present
      if (!ArrayPrototypeIncludes(realEntries, mountPoint)) {
        ArrayPrototypePush(realEntries, mountPoint)
      }
      return realEntries
    }
    return undefined // Fall through to real fs
  },

  realpathSync(path, _options) {
    // Check SEA paths first (/sea/*)
    if (isSeaPath(path)) {
      const exists = existsInSea(path)
      if (exists !== undefined) {
        if (exists) {
          return path
        }
        throw createENOENT('realpath', path)
      }
    }
    // Then check VFS paths (/snapshot/*)
    if (isVFSPath(path)) {
      if (existsInVFS(path)) {
        return path
      }
      // Non-overlay mode: VFS paths not in VFS return ENOENT
      if (!smolVfsState.overlay) {
        throw createENOENT('realpath', path)
      }
      // Overlay mode: rewrite path to extractDir if configured
      const rewritten = rewriteOverlayPath(path)
      if (rewritten && smolVfsState.originalRealpathSync) {
        return ReflectApply(smolVfsState.originalRealpathSync, shimmedFs, [
          rewritten,
          _options,
        ])
      }
    }
    // Special case: VFS prefix path itself (e.g., '/snapshot')
    if (hasVFS() && path === getVFSPrefix()) {
      return path
    }
    return undefined // Fall through to real fs
  },

  accessSync(path, _mode) {
    // Check SEA paths first (/sea/*)
    if (isSeaPath(path)) {
      const exists = existsInSea(path)
      if (exists !== undefined) {
        if (exists) {
          return true // Handled - SEA assets are always readable
        }
        throw createENOENT('access', path)
      }
    }
    // Then check VFS paths (/snapshot/*)
    if (isVFSPath(path)) {
      if (existsInVFS(path)) {
        return true // Handled - VFS files are always readable
      }
      // Overlay mode: rewrite path to extractDir if configured
      if (smolVfsState.overlay) {
        const rewritten = rewriteOverlayPath(path)
        if (rewritten && smolVfsState.originalAccessSync) {
          return ReflectApply(smolVfsState.originalAccessSync, shimmedFs, [
            rewritten,
            _mode,
          ])
        }
      }
      throw createENOENT('access', path)
    }
    // Special case: VFS prefix path itself (e.g., '/snapshot')
    if (hasVFS() && path === getVFSPrefix()) {
      return true // VFS mount point is always accessible
    }
    return undefined // Fall through to real fs
  },

  // === Async Methods (callback-based) ===

  readFile(path, options, callback) {
    // Normalize arguments
    if (typeof options === 'function') {
      callback = options
      options = undefined
    }
    try {
      const result = smolHandlers.readFileSync(path, options)
      if (result !== undefined) {
        ProcessNextTick(callback, null, result)
        return true // Handled
      }
    } catch (err) {
      ProcessNextTick(callback, err)
      return true // Handled (with error)
    }
    return undefined // Fall through to real fs
  },

  stat(path, options, callback) {
    if (typeof options === 'function') {
      callback = options
      options = undefined
    }
    try {
      const result = smolHandlers.statSync(path, options)
      if (result !== undefined) {
        ProcessNextTick(callback, null, result)
        return true
      }
    } catch (err) {
      ProcessNextTick(callback, err)
      return true
    }
    return undefined
  },

  lstat(path, options, callback) {
    if (typeof options === 'function') {
      callback = options
      options = undefined
    }
    try {
      const result = smolHandlers.lstatSync(path, options)
      if (result !== undefined) {
        ProcessNextTick(callback, null, result)
        return true
      }
    } catch (err) {
      ProcessNextTick(callback, err)
      return true
    }
    return undefined
  },

  readdir(path, options, callback) {
    if (typeof options === 'function') {
      callback = options
      options = undefined
    }
    try {
      const result = smolHandlers.readdirSync(path, options)
      if (result !== undefined) {
        ProcessNextTick(callback, null, result)
        return true
      }
    } catch (err) {
      ProcessNextTick(callback, err)
      return true
    }
    return undefined
  },

  realpath(path, options, callback) {
    if (typeof options === 'function') {
      callback = options
      options = undefined
    }
    try {
      const result = smolHandlers.realpathSync(path, options)
      if (result !== undefined) {
        ProcessNextTick(callback, null, result)
        return true
      }
    } catch (err) {
      ProcessNextTick(callback, err)
      return true
    }
    return undefined
  },

  access(path, mode, callback) {
    if (typeof mode === 'function') {
      callback = mode
      mode = undefined
    }
    try {
      const result = smolHandlers.accessSync(path, mode)
      if (result !== undefined) {
        ProcessNextTick(callback, null)
        return true
      }
    } catch (err) {
      ProcessNextTick(callback, err)
      return true
    }
    return undefined
  },

  exists(path, callback) {
    const result = smolHandlers.existsSync(path)
    if (result !== undefined) {
      ProcessNextTick(callback, result)
      return true
    }
    return undefined
  },

  readlink(path, options, callback) {
    if (typeof options === 'function') {
      callback = options
      options = undefined
    }
    try {
      const result = smolHandlers.readlinkSync(path, options)
      if (result !== undefined) {
        ProcessNextTick(callback, null, result)
        return true
      }
    } catch (err) {
      ProcessNextTick(callback, err)
      return true
    }
    return undefined
  },

  // === Promise Methods ===

  readFilePromise(path, options) {
    try {
      const result = smolHandlers.readFileSync(path, options)
      if (result !== undefined) {
        return PromiseResolve(result)
      }
    } catch (err) {
      return PromiseReject(err)
    }
    return undefined
  },

  statPromise(path, options) {
    try {
      const result = smolHandlers.statSync(path, options)
      if (result !== undefined) {
        return PromiseResolve(result)
      }
    } catch (err) {
      return PromiseReject(err)
    }
    return undefined
  },

  lstatPromise(path, options) {
    try {
      const result = smolHandlers.lstatSync(path, options)
      if (result !== undefined) {
        return PromiseResolve(result)
      }
    } catch (err) {
      return PromiseReject(err)
    }
    return undefined
  },

  readdirPromise(path, options) {
    try {
      const result = smolHandlers.readdirSync(path, options)
      if (result !== undefined) {
        return PromiseResolve(result)
      }
    } catch (err) {
      return PromiseReject(err)
    }
    return undefined
  },

  realpathPromise(path, options) {
    try {
      const result = smolHandlers.realpathSync(path, options)
      if (result !== undefined) {
        return PromiseResolve(result)
      }
    } catch (err) {
      return PromiseReject(err)
    }
    return undefined
  },

  accessPromise(path, mode) {
    try {
      const result = smolHandlers.accessSync(path, mode)
      if (result !== undefined) {
        return PromiseResolve()
      }
    } catch (err) {
      return PromiseReject(err)
    }
    return undefined
  },

  readlinkPromise(path, options) {
    try {
      const result = smolHandlers.readlinkSync(path, options)
      if (result !== undefined) {
        return PromiseResolve(result)
      }
    } catch (err) {
      return PromiseReject(err)
    }
    return undefined
  },

  // === Write Operations (all throw EROFS) ===

  writeFileSync(path, _data, _options) {
    if (isVirtualPath(path)) {
      throw createEROFS('write', path)
    }
    return undefined
  },

  appendFileSync(path, _data, _options) {
    if (isVirtualPath(path)) {
      throw createEROFS('appendfile', path)
    }
    return undefined
  },

  unlinkSync(path) {
    if (isVirtualPath(path)) {
      throw createEROFS('unlink', path)
    }
    return undefined
  },

  rmdirSync(path, _options) {
    if (isVirtualPath(path)) {
      throw createEROFS('rmdir', path)
    }
    return undefined
  },

  mkdirSync(path, _options) {
    if (isVirtualPath(path)) {
      throw createEROFS('mkdir', path)
    }
    return undefined
  },

  renameSync(oldPath, newPath) {
    if (isVirtualPath(oldPath)) {
      throw createEROFS('rename', oldPath)
    }
    if (isVirtualPath(newPath)) {
      throw createEROFS('rename', newPath)
    }
    return undefined
  },

  copyFileSync(src, dest, _mode) {
    // Allow copying FROM VFS/SEA, but not TO
    if (isVirtualPath(dest)) {
      throw createEROFS('copyfile', dest)
    }
    return undefined
  },

  // === Additional Intercepts ===

  // realpathSync.native - same behavior as realpathSync for VFS
  realpathSyncNative(path, _options) {
    return smolHandlers.realpathSync(path, _options)
  },

  // NOTE: glob/globSync work automatically via our shimmed lstat/readdir.
  // Node's internal/fs/glob.js imports from 'fs' (not bindings), so it gets
  // our shimmed functions when loaded lazily after bootstrap. No explicit
  // glob handlers needed - symlinks are properly detected via isSymbolicLink().
}

/**
 * Install VFS shims into fs module using handler-based pattern
 * @param {object} fs - The fs module to shim
 * @param {object} [options] - Options for VFS behavior
 * @param {boolean} [options.overlay=false] - When true (SEA mode), only files
 *   that exist in VFS are intercepted; others fall through to real fs.
 *   When false, ALL paths under mount point are intercepted (ENOENT for
 *   non-existent VFS files instead of falling through).
 * @param {string} [options.extractDir] - Base directory for overlay fallthrough.
 *   When set with overlay=true, VFS paths not found in VFS are rewritten
 *   from /snapshot/foo/bar → extractDir/foo/bar before falling through to
 *   the real filesystem. Without this, overlay falls through using the
 *   original /snapshot/... path (which typically doesn't exist on disk).
 */
function installVFSShims(fs, options) {
  if (!hasVFS()) {
    // No VFS available
    return
  }

  if (shimmedFs === fs) {
    // Already shimmed
    return
  }

  shimmedFs = fs

  const opts = { __proto__: null, ...options }
  smolVfsState.overlay = opts.overlay === true
  smolVfsState.extractDir = opts.extractDir
  smolVfsState.extractDirResolved = opts.extractDir
    ? PathResolve(opts.extractDir)
    : undefined

  // Enable handlers
  smolVfsState.handlers = smolHandlers

  // Save original methods
  const originalReadFileSync = fs.readFileSync
  // Store readdirSync in state for root directory merging (glob support)
  smolVfsState.originalReaddirSync = fs.readdirSync
  const originalExistsSync = fs.existsSync
  const originalStatSync = fs.statSync
  const originalLstatSync = fs.lstatSync
  const originalReaddirSync = fs.readdirSync
  const originalRealpathSync = fs.realpathSync
  const originalAccessSync = fs.accessSync
  const originalReadlinkSync = fs.readlinkSync
  const originalReadFile = fs.readFile
  const originalStat = fs.stat
  const originalLstat = fs.lstat
  const originalReadlink = fs.readlink
  const originalReaddir = fs.readdir
  const originalRealpath = fs.realpath
  const originalAccess = fs.access
  const originalExists = fs.exists
  const originalWriteFileSync = fs.writeFileSync
  const originalAppendFileSync = fs.appendFileSync
  const originalUnlinkSync = fs.unlinkSync
  const originalRmdirSync = fs.rmdirSync
  const originalMkdirSync = fs.mkdirSync
  const originalRenameSync = fs.renameSync
  const originalCopyFileSync = fs.copyFileSync

  // Store originals in state for overlay path rewriting
  smolVfsState.originalReadFileSync = originalReadFileSync
  smolVfsState.originalExistsSync = originalExistsSync
  smolVfsState.originalStatSync = originalStatSync
  smolVfsState.originalLstatSync = originalLstatSync
  smolVfsState.originalRealpathSync = originalRealpathSync
  smolVfsState.originalAccessSync = originalAccessSync
  smolVfsState.originalReadlinkSync = originalReadlinkSync
  smolVfsState.originalReadFile = originalReadFile
  smolVfsState.originalStat = originalStat
  smolVfsState.originalLstat = originalLstat
  smolVfsState.originalReaddir = originalReaddir
  smolVfsState.originalRealpath = originalRealpath
  smolVfsState.originalAccess = originalAccess
  smolVfsState.originalExists = originalExists
  smolVfsState.originalReadlink = originalReadlink
  smolVfsState.originalWriteFileSync = originalWriteFileSync
  smolVfsState.originalAppendFileSync = originalAppendFileSync
  smolVfsState.originalUnlinkSync = originalUnlinkSync
  smolVfsState.originalRmdirSync = originalRmdirSync
  smolVfsState.originalMkdirSync = originalMkdirSync
  smolVfsState.originalRenameSync = originalRenameSync
  smolVfsState.originalCopyFileSync = originalCopyFileSync

  // === Sync Methods ===

  ObjectDefineProperty(fs, 'readFileSync', {
    configurable: true,
    enumerable: true,
    value: function readFileSync(path, options) {
      const h = smolVfsState.handlers
      if (h !== undefined) {
        const result = h.readFileSync(path, options)
        if (result !== undefined) return result
      }
      return ReflectApply(originalReadFileSync, fs, [path, options])
    },
    writable: true,
  })

  ObjectDefineProperty(fs, 'existsSync', {
    configurable: true,
    enumerable: true,
    value: function existsSync(path) {
      const h = smolVfsState.handlers
      if (h !== undefined) {
        const result = h.existsSync(path)
        if (result !== undefined) return result
      }
      return ReflectApply(originalExistsSync, fs, [path])
    },
    writable: true,
  })

  ObjectDefineProperty(fs, 'statSync', {
    configurable: true,
    enumerable: true,
    value: function statSync(path, options) {
      const h = smolVfsState.handlers
      if (h !== undefined) {
        const result = h.statSync(path, options)
        if (result !== undefined) return result
      }
      return ReflectApply(originalStatSync, fs, [path, options])
    },
    writable: true,
  })

  ObjectDefineProperty(fs, 'lstatSync', {
    configurable: true,
    enumerable: true,
    value: function lstatSync(path, options) {
      const h = smolVfsState.handlers
      if (h !== undefined) {
        const result = h.lstatSync(path, options)
        if (result !== undefined) return result
      }
      return ReflectApply(originalLstatSync, fs, [path, options])
    },
    writable: true,
  })

  ObjectDefineProperty(fs, 'readdirSync', {
    configurable: true,
    enumerable: true,
    value: function readdirSync(path, options) {
      const h = smolVfsState.handlers
      if (h !== undefined) {
        const result = h.readdirSync(path, options)
        if (result !== undefined) return result
      }
      return ReflectApply(originalReaddirSync, fs, [path, options])
    },
    writable: true,
  })

  // Shim realpathSync with .native property
  const realpathSyncShim = function realpathSync(path, options) {
    const h = smolVfsState.handlers
    if (h !== undefined) {
      const result = h.realpathSync(path, options)
      if (result !== undefined) return result
    }
    return ReflectApply(originalRealpathSync, fs, [path, options])
  }

  // Add .native that also checks VFS (item 4: missing intercept)
  realpathSyncShim.native = function realpathSyncNative(path, options) {
    const h = smolVfsState.handlers
    if (h !== undefined) {
      const result = h.realpathSyncNative(path, options)
      if (result !== undefined) return result
    }
    // Fall through to original native if available
    if (originalRealpathSync.native) {
      return ReflectApply(originalRealpathSync.native, fs, [path, options])
    }
    return ReflectApply(originalRealpathSync, fs, [path, options])
  }

  ObjectDefineProperty(fs, 'realpathSync', {
    configurable: true,
    enumerable: true,
    value: realpathSyncShim,
    writable: true,
  })

  ObjectDefineProperty(fs, 'accessSync', {
    configurable: true,
    enumerable: true,
    value: function accessSync(path, mode) {
      const h = smolVfsState.handlers
      if (h !== undefined) {
        const result = h.accessSync(path, mode)
        if (result !== undefined) return
      }
      return ReflectApply(originalAccessSync, fs, [path, mode])
    },
    writable: true,
  })

  ObjectDefineProperty(fs, 'readlinkSync', {
    configurable: true,
    enumerable: true,
    value: function readlinkSync(path, options) {
      const h = smolVfsState.handlers
      if (h !== undefined) {
        const result = h.readlinkSync(path, options)
        if (result !== undefined) return result
      }
      return ReflectApply(originalReadlinkSync, fs, [path, options])
    },
    writable: true,
  })

  // === Write Operations (read-only VFS) ===

  ObjectDefineProperty(fs, 'writeFileSync', {
    configurable: true,
    enumerable: true,
    value: function writeFileSync(path, data, options) {
      const h = smolVfsState.handlers
      if (h !== undefined) {
        const result = h.writeFileSync(path, data, options)
        if (result !== undefined) return result
      }
      return ReflectApply(originalWriteFileSync, fs, [path, data, options])
    },
    writable: true,
  })

  ObjectDefineProperty(fs, 'appendFileSync', {
    configurable: true,
    enumerable: true,
    value: function appendFileSync(path, data, options) {
      const h = smolVfsState.handlers
      if (h !== undefined) {
        const result = h.appendFileSync(path, data, options)
        if (result !== undefined) return result
      }
      return ReflectApply(originalAppendFileSync, fs, [path, data, options])
    },
    writable: true,
  })

  ObjectDefineProperty(fs, 'unlinkSync', {
    configurable: true,
    enumerable: true,
    value: function unlinkSync(path) {
      const h = smolVfsState.handlers
      if (h !== undefined) {
        const result = h.unlinkSync(path)
        if (result !== undefined) return result
      }
      return ReflectApply(originalUnlinkSync, fs, [path])
    },
    writable: true,
  })

  ObjectDefineProperty(fs, 'rmdirSync', {
    configurable: true,
    enumerable: true,
    value: function rmdirSync(path, options) {
      const h = smolVfsState.handlers
      if (h !== undefined) {
        const result = h.rmdirSync(path, options)
        if (result !== undefined) return result
      }
      return ReflectApply(originalRmdirSync, fs, [path, options])
    },
    writable: true,
  })

  ObjectDefineProperty(fs, 'mkdirSync', {
    configurable: true,
    enumerable: true,
    value: function mkdirSync(path, options) {
      const h = smolVfsState.handlers
      if (h !== undefined) {
        const result = h.mkdirSync(path, options)
        if (result !== undefined) return result
      }
      return ReflectApply(originalMkdirSync, fs, [path, options])
    },
    writable: true,
  })

  ObjectDefineProperty(fs, 'renameSync', {
    configurable: true,
    enumerable: true,
    value: function renameSync(oldPath, newPath) {
      const h = smolVfsState.handlers
      if (h !== undefined) {
        const result = h.renameSync(oldPath, newPath)
        if (result !== undefined) return result
      }
      return ReflectApply(originalRenameSync, fs, [oldPath, newPath])
    },
    writable: true,
  })

  ObjectDefineProperty(fs, 'copyFileSync', {
    configurable: true,
    enumerable: true,
    value: function copyFileSync(src, dest, mode) {
      const h = smolVfsState.handlers
      if (h !== undefined) {
        const result = h.copyFileSync(src, dest, mode)
        if (result !== undefined) return result
      }
      return ReflectApply(originalCopyFileSync, fs, [src, dest, mode])
    },
    writable: true,
  })

  // === Async Methods (Item 1: Add async fs method support) ===

  ObjectDefineProperty(fs, 'readFile', {
    configurable: true,
    enumerable: true,
    value: function readFile(path, options, callback) {
      const h = smolVfsState.handlers
      if (h !== undefined) {
        const result = h.readFile(path, options, callback)
        if (result !== undefined) return
      }
      return ReflectApply(originalReadFile, fs, [path, options, callback])
    },
    writable: true,
  })

  ObjectDefineProperty(fs, 'stat', {
    configurable: true,
    enumerable: true,
    value: function stat(path, options, callback) {
      const h = smolVfsState.handlers
      if (h !== undefined) {
        const result = h.stat(path, options, callback)
        if (result !== undefined) return
      }
      return ReflectApply(originalStat, fs, [path, options, callback])
    },
    writable: true,
  })

  ObjectDefineProperty(fs, 'lstat', {
    configurable: true,
    enumerable: true,
    value: function lstat(path, options, callback) {
      const h = smolVfsState.handlers
      if (h !== undefined) {
        const result = h.lstat(path, options, callback)
        if (result !== undefined) return
      }
      return ReflectApply(originalLstat, fs, [path, options, callback])
    },
    writable: true,
  })

  ObjectDefineProperty(fs, 'readlink', {
    configurable: true,
    enumerable: true,
    value: function readlink(path, options, callback) {
      const h = smolVfsState.handlers
      if (h !== undefined) {
        const result = h.readlink(path, options, callback)
        if (result !== undefined) return
      }
      return ReflectApply(originalReadlink, fs, [path, options, callback])
    },
    writable: true,
  })

  ObjectDefineProperty(fs, 'readdir', {
    configurable: true,
    enumerable: true,
    value: function readdir(path, options, callback) {
      const h = smolVfsState.handlers
      if (h !== undefined) {
        const result = h.readdir(path, options, callback)
        if (result !== undefined) return
      }
      return ReflectApply(originalReaddir, fs, [path, options, callback])
    },
    writable: true,
  })

  // Shim realpath with .native property
  const realpathShim = function realpath(path, options, callback) {
    const h = smolVfsState.handlers
    if (h !== undefined) {
      const result = h.realpath(path, options, callback)
      if (result !== undefined) return
    }
    return ReflectApply(originalRealpath, fs, [path, options, callback])
  }

  realpathShim.native = function realpathNative(path, options, callback) {
    const h = smolVfsState.handlers
    if (h !== undefined) {
      const result = h.realpath(path, options, callback)
      if (result !== undefined) return
    }
    if (originalRealpath.native) {
      return ReflectApply(originalRealpath.native, fs, [
        path,
        options,
        callback,
      ])
    }
    return ReflectApply(originalRealpath, fs, [path, options, callback])
  }

  ObjectDefineProperty(fs, 'realpath', {
    configurable: true,
    enumerable: true,
    value: realpathShim,
    writable: true,
  })

  ObjectDefineProperty(fs, 'access', {
    configurable: true,
    enumerable: true,
    value: function access(path, mode, callback) {
      const h = smolVfsState.handlers
      if (h !== undefined) {
        const result = h.access(path, mode, callback)
        if (result !== undefined) return
      }
      return ReflectApply(originalAccess, fs, [path, mode, callback])
    },
    writable: true,
  })

  ObjectDefineProperty(fs, 'exists', {
    configurable: true,
    enumerable: true,
    value: function exists(path, callback) {
      const h = smolVfsState.handlers
      if (h !== undefined) {
        const result = h.exists(path, callback)
        if (result !== undefined) return
      }
      return ReflectApply(originalExists, fs, [path, callback])
    },
    writable: true,
  })

  // === fs.promises Shims ===
  // Note: fs.promises may not be available at bootstrap time
  // These are installed lazily when fs.promises is accessed
  if (fs.promises) {
    installPromiseShims(fs.promises)
  }

  // Emit vfs-mount event with mount info
  const mountInfo = {
    __proto__: null,
    mountPoint: getVFSPrefix(),
    overlay: smolVfsState.overlay,
  }
  ProcessEmit('vfs-mount', mountInfo)

  if (ProcessEnv.NODE_DEBUG_VFS) {
    ProcessRawDebug(
      'VFS: Filesystem shims installed (SmolProvider with async support)',
    )
  }
}

/**
 * Remove VFS shims from fs module, restoring original methods.
 * Emits 'vfs-unmount' event on process after restoration.
 */
function removeVFSShims() {
  if (shimmedFs === undefined) {
    // Not shimmed
    return
  }

  const fs = shimmedFs
  const mountInfo = {
    __proto__: null,
    mountPoint: getVFSPrefix(),
    overlay: smolVfsState.overlay,
  }

  // Restore original methods on the fs object
  fs.readFileSync = smolVfsState.originalReadFileSync
  fs.existsSync = smolVfsState.originalExistsSync
  fs.statSync = smolVfsState.originalStatSync
  fs.lstatSync = smolVfsState.originalLstatSync
  fs.readdirSync = smolVfsState.originalReaddirSync
  fs.realpathSync = smolVfsState.originalRealpathSync
  fs.accessSync = smolVfsState.originalAccessSync
  fs.readlinkSync = smolVfsState.originalReadlinkSync
  fs.readFile = smolVfsState.originalReadFile
  fs.stat = smolVfsState.originalStat
  fs.lstat = smolVfsState.originalLstat
  fs.readdir = smolVfsState.originalReaddir
  fs.realpath = smolVfsState.originalRealpath
  fs.access = smolVfsState.originalAccess
  fs.exists = smolVfsState.originalExists
  fs.readlink = smolVfsState.originalReadlink
  fs.writeFileSync = smolVfsState.originalWriteFileSync
  fs.appendFileSync = smolVfsState.originalAppendFileSync
  fs.unlinkSync = smolVfsState.originalUnlinkSync
  fs.rmdirSync = smolVfsState.originalRmdirSync
  fs.mkdirSync = smolVfsState.originalMkdirSync
  fs.renameSync = smolVfsState.originalRenameSync
  fs.copyFileSync = smolVfsState.originalCopyFileSync

  // Disable handlers and clear state
  smolVfsState.handlers = undefined
  smolVfsState.overlay = false
  smolVfsState.extractDir = undefined
  smolVfsState.extractDirResolved = undefined
  smolVfsState.originalReaddirSync = undefined
  smolVfsState.originalReadFileSync = undefined
  smolVfsState.originalExistsSync = undefined
  smolVfsState.originalStatSync = undefined
  smolVfsState.originalLstatSync = undefined
  smolVfsState.originalRealpathSync = undefined
  smolVfsState.originalAccessSync = undefined
  smolVfsState.originalReadlinkSync = undefined
  smolVfsState.originalReadFile = undefined
  smolVfsState.originalStat = undefined
  smolVfsState.originalLstat = undefined
  smolVfsState.originalReaddir = undefined
  smolVfsState.originalRealpath = undefined
  smolVfsState.originalAccess = undefined
  smolVfsState.originalExists = undefined
  smolVfsState.originalReadlink = undefined
  smolVfsState.originalWriteFileSync = undefined
  smolVfsState.originalAppendFileSync = undefined
  smolVfsState.originalUnlinkSync = undefined
  smolVfsState.originalRmdirSync = undefined
  smolVfsState.originalMkdirSync = undefined
  smolVfsState.originalRenameSync = undefined
  smolVfsState.originalCopyFileSync = undefined
  shimmedFs = undefined

  // Emit vfs-unmount event
  ProcessEmit('vfs-unmount', mountInfo)

  if (ProcessEnv.NODE_DEBUG_VFS) {
    ProcessRawDebug('VFS: Filesystem shims removed')
  }
}

/**
 * Install promise-based fs shims
 */
function installPromiseShims(fsPromises) {
  const originalReadFile = fsPromises.readFile
  const originalStat = fsPromises.stat
  const originalLstat = fsPromises.lstat
  const originalReadlink = fsPromises.readlink
  const originalReaddir = fsPromises.readdir
  const originalRealpath = fsPromises.realpath
  const originalAccess = fsPromises.access

  ObjectDefineProperty(fsPromises, 'readFile', {
    configurable: true,
    enumerable: true,
    value: function readFile(path, options) {
      const h = smolVfsState.handlers
      if (h !== undefined) {
        const result = h.readFilePromise(path, options)
        if (result !== undefined) return result
      }
      return ReflectApply(originalReadFile, fsPromises, [path, options])
    },
    writable: true,
  })

  ObjectDefineProperty(fsPromises, 'stat', {
    configurable: true,
    enumerable: true,
    value: function stat(path, options) {
      const h = smolVfsState.handlers
      if (h !== undefined) {
        const result = h.statPromise(path, options)
        if (result !== undefined) return result
      }
      return ReflectApply(originalStat, fsPromises, [path, options])
    },
    writable: true,
  })

  ObjectDefineProperty(fsPromises, 'lstat', {
    configurable: true,
    enumerable: true,
    value: function lstat(path, options) {
      const h = smolVfsState.handlers
      if (h !== undefined) {
        const result = h.lstatPromise(path, options)
        if (result !== undefined) return result
      }
      return ReflectApply(originalLstat, fsPromises, [path, options])
    },
    writable: true,
  })

  ObjectDefineProperty(fsPromises, 'readlink', {
    configurable: true,
    enumerable: true,
    value: function readlink(path, options) {
      const h = smolVfsState.handlers
      if (h !== undefined) {
        const result = h.readlinkPromise(path, options)
        if (result !== undefined) return result
      }
      return ReflectApply(originalReadlink, fsPromises, [path, options])
    },
    writable: true,
  })

  ObjectDefineProperty(fsPromises, 'readdir', {
    configurable: true,
    enumerable: true,
    value: function readdir(path, options) {
      const h = smolVfsState.handlers
      if (h !== undefined) {
        const result = h.readdirPromise(path, options)
        if (result !== undefined) return result
      }
      return ReflectApply(originalReaddir, fsPromises, [path, options])
    },
    writable: true,
  })

  ObjectDefineProperty(fsPromises, 'realpath', {
    configurable: true,
    enumerable: true,
    value: function realpath(path, options) {
      const h = smolVfsState.handlers
      if (h !== undefined) {
        const result = h.realpathPromise(path, options)
        if (result !== undefined) return result
      }
      return ReflectApply(originalRealpath, fsPromises, [path, options])
    },
    writable: true,
  })

  ObjectDefineProperty(fsPromises, 'access', {
    configurable: true,
    enumerable: true,
    value: function access(path, mode) {
      const h = smolVfsState.handlers
      if (h !== undefined) {
        const result = h.accessPromise(path, mode)
        if (result !== undefined) return result
      }
      return ReflectApply(originalAccess, fsPromises, [path, mode])
    },
    writable: true,
  })
}

/**
 * Check if Node.js upstream VFS (node:vfs) is enabled.
 * This tracks the useVfs SEA flag from PR #61478.
 * When that PR lands, we can detect if upstream VFS is active
 * and potentially register as a SmolProvider.
 *
 * Item 3: Track useVfs SEA flag for compatibility
 */
function isUpstreamVfsEnabled() {
  try {
    // This will be available when Node.js PR #61478 lands
    const sea = require('internal/sea')
    if (sea && typeof sea.isVfsEnabled === 'function') {
      return sea.isVfsEnabled()
    }
  } catch {
    // sea module not available or doesn't have isVfsEnabled
  }
  return false
}

/**
 * Get the SmolProvider state for testing/debugging
 */
function getSmolVfsState() {
  return smolVfsState
}

module.exports = ObjectFreeze({
  __proto__: null,
  getSmolVfsState,
  installPromiseShims,
  installVFSShims,
  isUpstreamVfsEnabled,
  removeVFSShims,
  smolHandlers,
  smolVfsState,
})
