'use strict'

/**
 * Filesystem shims for VFS and SEA (SmolProvider)
 *
 * Patches fs module methods to transparently read from:
 * 1. /sea/* paths - Node.js SEA blob assets (via node:sea module)
 * 2. /snapshot/* paths - Socket Security VFS (embedded tar archive)
 *
 * Priority: SEA paths checked first, then VFS paths, then fall through to real fs
 *
 * Architecture:
 * - Uses a handler-based pattern (smolVfsState.handlers) that integrates at the
 *   start of fs method bodies, ensuring captured references work correctly:
 *     const { readFileSync } = require('fs');
 *     installVFSShims(fs); // Even works if captured before this
 *     readFileSync('/snapshot/file.txt'); // Intercepted correctly
 *
 * - Async methods use process.nextTick to defer callbacks, matching Node.js behavior
 *
 * - Supports realpathSync.native and glob* methods for complete fs coverage
 *
 * Naming: Uses "Smol" prefix to avoid conflicts with Node.js's upcoming node:vfs
 * module (PR #61478). When that lands, our provider could be registered as a
 * SmolProvider alongside their SEAProvider/MemoryProvider.
 */

// Use primordials for protection against prototype pollution
const {
  ArrayPrototypeIncludes,
  ArrayPrototypePush,
  Error: ErrorConstructor,
  ObjectDefineProperty,
  ObjectFreeze,
  PromiseResolve,
  PromiseReject,
  ReflectApply,
  StringPrototypeSlice,
} = primordials

const {
  createStatObject,
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
  // Store original functions for handlers that need to merge results
  originalReaddirSync: undefined,
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
      const realEntries = smolVfsState.originalReaddirSync('/', options)
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
    if (isVFSPath(path) && existsInVFS(path)) {
      return path
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
 */
function installVFSShims(fs) {
  if (!hasVFS()) {
    // No VFS available
    return
  }

  if (shimmedFs === fs) {
    // Already shimmed
    return
  }

  shimmedFs = fs

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
      return ReflectApply(originalRealpath.native, fs, [path, options, callback])
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

  if (ProcessEnv.NODE_DEBUG_VFS) {
    ProcessRawDebug('VFS: Filesystem shims installed (SmolProvider with async support)')
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
import process from 'process'

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
  getSmolVfsState,
  installPromiseShims,
  installVFSShims,
  isUpstreamVfsEnabled,
  smolHandlers,
  smolVfsState,
})
