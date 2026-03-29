'use strict'

/**
 * VFS Bootstrap
 *
 * This module is loaded early in Node.js bootstrap to initialize
 * the Virtual Filesystem if CUSTOM_VFS_BLOB is present.
 *
 * CRITICAL: All heavy imports are LAZY (inside setupVFS) to avoid
 * loading safe-references, fs_shim, and loader when VFS is not present.
 * This saves ~72 module loads for non-SEA binaries.
 */

const { ObjectFreeze } = primordials

function setupVFS() {
  // Check for VFS BEFORE loading any heavy modules.
  // Direct internalBinding check — does NOT load vfs/loader, safe-references,
  // smol/debug, or any other module. Zero overhead when VFS is absent.
  let vfsBinding
  try {
    vfsBinding = internalBinding('smol_vfs')
  } catch {
    return false
  }
  if (!vfsBinding || !vfsBinding.hasVFSBlob()) {
    return false
  }

  // VFS is present — now load the heavy modules.
  const { initVFS } = require('internal/socketsecurity/vfs/loader')

  // VFS present — now load the heavy dependencies.
  const {
    ProcessEnv,
    ProcessRawDebug,
  } = require('internal/socketsecurity/safe-references')
  const { installVFSShims } = require('internal/socketsecurity/vfs/fs_shim')

  // Initialize VFS
  const vfs = initVFS()
  if (!vfs) {
    return false
  }

  // Install fs shims
  // eslint-disable-next-line n/prefer-node-protocol
  const fs = require('fs')
  installVFSShims(fs)

  if (ProcessEnv.NODE_DEBUG_VFS) {
    ProcessRawDebug('VFS: Bootstrap complete')
  }

  return true
}

module.exports = ObjectFreeze({
  __proto__: null,
  setupVFS,
})
