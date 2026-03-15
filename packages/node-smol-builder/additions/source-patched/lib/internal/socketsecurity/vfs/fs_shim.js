'use strict'

/**
 * Filesystem shims for VFS and SEA
 *
 * Patches fs module methods to transparently read from:
 * 1. /sea/* paths - Node.js SEA blob assets (via node:sea module)
 * 2. /snapshot/* paths - Socket Security VFS (embedded tar archive)
 *
 * Priority: SEA paths checked first, then VFS paths, then fall through to real fs
 */

// Use primordials for protection against prototype pollution
const {
  Error: ErrorConstructor,
  ObjectDefineProperty,
  ObjectFreeze,
  ReflectApply,
} = primordials

const {
  ProcessEnv,
  ProcessRawDebug,
} = require('internal/socketsecurity/safe-references')
const {
  existsInVFS,
  hasVFS,
  isVFSPath,
  readFileFromVFS,
  readdirFromVFS,
  statFromVFS,
} = require('internal/socketsecurity/vfs/loader')
const {
  existsInSea,
  isSeaPath,
  readFileFromSea,
  readdirFromSea,
  statFromSea,
} = require('internal/socketsecurity/vfs/sea_path')

let shimmedFs

/**
 * Install VFS shims into fs module
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

  // Save original methods
  const originalReadFileSync = fs.readFileSync
  const originalExistsSync = fs.existsSync
  const originalStatSync = fs.statSync
  const originalLstatSync = fs.lstatSync
  const originalReaddirSync = fs.readdirSync
  const originalRealpathSync = fs.realpathSync
  const originalAccessSync = fs.accessSync

  // Shim readFileSync
  // Use ObjectDefineProperty for safer assignment
  // Priority: SEA paths (/sea/*) → VFS paths (/snapshot/*) → real fs
  ObjectDefineProperty(fs, 'readFileSync', {
    configurable: true,
    enumerable: true,
    value: function readFileSync(path, options) {
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
      return ReflectApply(originalReadFileSync, fs, [path, options])
    },
    writable: true,
  })

  // Shim existsSync
  ObjectDefineProperty(fs, 'existsSync', {
    configurable: true,
    enumerable: true,
    value: function existsSync(path) {
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
      return ReflectApply(originalExistsSync, fs, [path])
    },
    writable: true,
  })

  // Shim statSync
  ObjectDefineProperty(fs, 'statSync', {
    configurable: true,
    enumerable: true,
    value: function statSync(path, options) {
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
      return ReflectApply(originalStatSync, fs, [path, options])
    },
    writable: true,
  })

  // Shim lstatSync (same as statSync for VFS/SEA - no symlinks)
  ObjectDefineProperty(fs, 'lstatSync', {
    configurable: true,
    enumerable: true,
    value: function lstatSync(path, options) {
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
      return ReflectApply(originalLstatSync, fs, [path, options])
    },
    writable: true,
  })

  // Shim readdirSync
  ObjectDefineProperty(fs, 'readdirSync', {
    configurable: true,
    enumerable: true,
    value: function readdirSync(path, options) {
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
      return ReflectApply(originalReaddirSync, fs, [path, options])
    },
    writable: true,
  })

  // Shim realpathSync (just return the path for VFS/SEA)
  ObjectDefineProperty(fs, 'realpathSync', {
    configurable: true,
    enumerable: true,
    value: function realpathSync(path, options) {
      // Check SEA paths first (/sea/*)
      if (isSeaPath(path)) {
        const exists = existsInSea(path)
        if (exists !== undefined) {
          if (exists) {
            return path
          }
          // Asset doesn't exist in SEA
          const error = new ErrorConstructor(
            `ENOENT: no such file or directory, realpath '${path}'`,
          )
          error.code = 'ENOENT'
          error.errno = -2
          error.syscall = 'realpath'
          error.path = path
          throw error
        }
      }
      // Then check VFS paths (/snapshot/*)
      if (isVFSPath(path) && existsInVFS(path)) {
        return path
      }
      return ReflectApply(originalRealpathSync, fs, [path, options])
    },
    writable: true,
  })

  // Shim accessSync (check if file exists in VFS/SEA)
  ObjectDefineProperty(fs, 'accessSync', {
    configurable: true,
    enumerable: true,
    value: function accessSync(path, mode) {
      // Check SEA paths first (/sea/*)
      if (isSeaPath(path)) {
        const exists = existsInSea(path)
        if (exists !== undefined) {
          if (exists) {
            // SEA assets are always readable
            return undefined
          }
          // Asset doesn't exist in SEA
          const error = new ErrorConstructor(
            `ENOENT: no such file or directory, access '${path}'`,
          )
          error.code = 'ENOENT'
          error.errno = -2
          error.syscall = 'access'
          error.path = path
          throw error
        }
      }
      // Then check VFS paths (/snapshot/*)
      if (isVFSPath(path)) {
        if (existsInVFS(path)) {
          // VFS files are always readable
          return undefined
        }
        // File doesn't exist in VFS
        const error = new ErrorConstructor(
          `ENOENT: no such file or directory, access '${path}'`,
        )
        error.code = 'ENOENT'
        error.errno = -2
        error.syscall = 'access'
        error.path = path
        throw error
      }
      return ReflectApply(originalAccessSync, fs, [path, mode])
    },
    writable: true,
  })

  if (ProcessEnv.NODE_DEBUG_VFS) {
    ProcessRawDebug('VFS: Filesystem shims installed (VFS + SEA path support)')
  }
}

module.exports = ObjectFreeze({
  installVFSShims,
})
