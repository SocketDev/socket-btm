'use strict'

/**
 * Filesystem shims for VFS
 *
 * Patches fs module methods to transparently read from VFS when appropriate
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
  ObjectDefineProperty(fs, 'readFileSync', {
    value: function readFileSync(path, options) {
      if (isVFSPath(path)) {
        const content = readFileFromVFS(path, options)
        if (content !== undefined) {
          return content
        }
      }
      return ReflectApply(originalReadFileSync, fs, [path, options])
    },
    writable: true,
    enumerable: true,
    configurable: true,
  })

  // Shim existsSync
  ObjectDefineProperty(fs, 'existsSync', {
    value: function existsSync(path) {
      if (isVFSPath(path)) {
        if (existsInVFS(path)) {
          return true
        }
      }
      return ReflectApply(originalExistsSync, fs, [path])
    },
    writable: true,
    enumerable: true,
    configurable: true,
  })

  // Shim statSync
  ObjectDefineProperty(fs, 'statSync', {
    value: function statSync(path, options) {
      if (isVFSPath(path)) {
        const stat = statFromVFS(path)
        if (stat !== undefined) {
          return stat
        }
      }
      return ReflectApply(originalStatSync, fs, [path, options])
    },
    writable: true,
    enumerable: true,
    configurable: true,
  })

  // Shim lstatSync (same as statSync for VFS - no symlinks yet)
  ObjectDefineProperty(fs, 'lstatSync', {
    value: function lstatSync(path, options) {
      if (isVFSPath(path)) {
        const stat = statFromVFS(path)
        if (stat !== undefined) {
          return stat
        }
      }
      return ReflectApply(originalLstatSync, fs, [path, options])
    },
    writable: true,
    enumerable: true,
    configurable: true,
  })

  // Shim readdirSync
  ObjectDefineProperty(fs, 'readdirSync', {
    value: function readdirSync(path, options) {
      if (isVFSPath(path)) {
        const entries = readdirFromVFS(path, options)
        if (entries !== undefined) {
          return entries
        }
      }
      return ReflectApply(originalReaddirSync, fs, [path, options])
    },
    writable: true,
    enumerable: true,
    configurable: true,
  })

  // Shim realpathSync (just return the path for VFS)
  ObjectDefineProperty(fs, 'realpathSync', {
    value: function realpathSync(path, options) {
      if (isVFSPath(path) && existsInVFS(path)) {
        return path
      }
      return ReflectApply(originalRealpathSync, fs, [path, options])
    },
    writable: true,
    enumerable: true,
    configurable: true,
  })

  // Shim accessSync (check if file exists in VFS)
  ObjectDefineProperty(fs, 'accessSync', {
    value: function accessSync(path, mode) {
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
    enumerable: true,
    configurable: true,
  })

  if (ProcessEnv.NODE_DEBUG_VFS) {
    ProcessRawDebug('VFS: Filesystem shims installed')
  }
}

module.exports = ObjectFreeze({
  installVFSShims,
})
