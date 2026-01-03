'use strict'

/**
 * VFS Bootstrap
 *
 * This module is loaded early in Node.js bootstrap to initialize
 * the Virtual Filesystem if CUSTOM_VFS_BLOB is present.
 */

const { installVFSShims } = require('internal/socketsecurity_vfs/fs_shim')
const { hasVFS, initVFS } = require('internal/socketsecurity_vfs/loader')

function setupVFS() {
  if (!hasVFS()) {
    // No VFS blob - normal Node.js mode
    return false
  }

  // Initialize VFS
  const vfs = initVFS()
  if (!vfs) {
    return false
  }

  // Install fs shims
  // eslint-disable-next-line n/prefer-node-protocol
  const fs = require('fs')
  installVFSShims(fs)

  if (process.env.NODE_DEBUG_VFS) {
    process._rawDebug('VFS: Bootstrap complete')
  }

  return true
}

module.exports = {
  setupVFS,
}
