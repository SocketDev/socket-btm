'use strict'

/**
 * Hybrid TAR parser for Virtual Filesystem
 *
 * Strategy:
 * 1. Try native tar (fast, robust)
 * 2. Fall back to pure JS (portable, no dependencies)
 */

// Lazy-load hasNativeTar to avoid bootstrap issues with child_process
// This module is only imported when actually needed, not at module load time
let hasNativeTar

function getHasNativeTar() {
  if (!hasNativeTar) {
    hasNativeTar =
      require('internal/socketsecurity_vfs/tar_parser_native').hasNativeTar
  }
  return hasNativeTar
}

/**
 * Parse TAR archive using best available method
 *
 * @param {Buffer} tarBuffer - TAR archive data
 * @returns {Map<string, Buffer>} Map of filename to file content
 */
function parseTar(tarBuffer) {
  // Check environment override
  if (process.env.VFS_FORCE_JS_TAR === '1') {
    if (process.env.NODE_DEBUG_VFS) {
      process._rawDebug(
        'VFS: Using JS tar parser (forced via VFS_FORCE_JS_TAR)',
      )
    }
    const {
      parseTar: parseTarJS,
    } = require('internal/socketsecurity_vfs/tar_parser')
    return parseTarJS(tarBuffer)
  }

  // Try native tar if available
  const hasNative = getHasNativeTar()
  if (hasNative()) {
    try {
      const {
        parseTar: parseTarNative,
      } = require('internal/socketsecurity_vfs/tar_parser_native')
      return parseTarNative(tarBuffer)
    } catch (err) {
      if (process.env.NODE_DEBUG_VFS) {
        process._rawDebug(`VFS: Native tar failed: ${err.message}`)
      }
      // Fall through to JS parser
    }
  }

  // Fall back to pure JS parser
  if (process.env.NODE_DEBUG_VFS) {
    process._rawDebug('VFS: Using pure JS tar parser')
  }
  const {
    parseTar: parseTarJS,
  } = require('internal/socketsecurity_vfs/tar_parser')
  return parseTarJS(tarBuffer)
}

// Re-export helper functions from pure JS parser (lazy-loaded)
const {
  getDirectoryListing,
  isDirectory,
} = require('internal/socketsecurity_vfs/tar_parser')

// Lazy-load gzip support to avoid bootstrap zlib dependency
let tarGzipModule

function getTarGzipModule() {
  if (!tarGzipModule) {
    tarGzipModule = require('internal/socketsecurity_vfs/tar_gzip')
  }
  return tarGzipModule
}

module.exports = {
  parseTar,
  // Lazy-load gzip functions
  parseTarGzip: (...args) => getTarGzipModule().parseTarGzip(...args),
  parseAuto: (...args) => getTarGzipModule().parseAuto(...args),
  getDirectoryListing,
  isDirectory,
  // Export wrapper that lazy-loads hasNativeTar
  hasNativeTar: () => getHasNativeTar()(),
}
