/**
 * Filesystem shims for VFS
 *
 * Patches fs module methods to transparently read from VFS when appropriate
 */

const {
  existsInVFS,
  hasVFS,
  isVFSPath,
  readFileFromVFS,
  readdirFromVFS,
  statFromVFS,
} = require('internal/socketsecurity_vfs/loader')

let shimmedFs = null

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
  fs.readFileSync = function readFileSync(path, options) {
    if (isVFSPath(path)) {
      const content = readFileFromVFS(path, options)
      if (content !== null) {
        return content
      }
    }
    return originalReadFileSync(path, options)
  }

  // Shim existsSync
  fs.existsSync = function existsSync(path) {
    if (isVFSPath(path)) {
      if (existsInVFS(path)) {
        return true
      }
    }
    return originalExistsSync(path)
  }

  // Shim statSync
  fs.statSync = function statSync(path, options) {
    if (isVFSPath(path)) {
      const stat = statFromVFS(path)
      if (stat !== null) {
        return stat
      }
    }
    return originalStatSync(path, options)
  }

  // Shim lstatSync (same as statSync for VFS - no symlinks yet)
  fs.lstatSync = function lstatSync(path, options) {
    if (isVFSPath(path)) {
      const stat = statFromVFS(path)
      if (stat !== null) {
        return stat
      }
    }
    return originalLstatSync(path, options)
  }

  // Shim readdirSync
  fs.readdirSync = function readdirSync(path, options) {
    if (isVFSPath(path)) {
      const entries = readdirFromVFS(path, options)
      if (entries !== null) {
        return entries
      }
    }
    return originalReaddirSync(path, options)
  }

  // Shim realpathSync (just return the path for VFS)
  fs.realpathSync = function realpathSync(path, options) {
    if (isVFSPath(path) && existsInVFS(path)) {
      return path
    }
    return originalRealpathSync(path, options)
  }

  // Shim accessSync (check if file exists in VFS)
  fs.accessSync = function accessSync(path, mode) {
    if (isVFSPath(path)) {
      if (existsInVFS(path)) {
        // VFS files are always readable
        return undefined
      }
      // File doesn't exist in VFS
      const error = new Error(
        `ENOENT: no such file or directory, access '${path}'`,
      )
      error.code = 'ENOENT'
      error.errno = -2
      error.syscall = 'access'
      error.path = path
      throw error
    }
    return originalAccessSync(path, mode)
  }

  if (process.env.NODE_DEBUG_VFS) {
    process._rawDebug('VFS: Filesystem shims installed')
  }
}

module.exports = {
  installVFSShims,
}
