'use strict'

/**
 * TAR parser for Virtual Filesystem
 *
 * Uses pure JavaScript TAR parser for consistent behavior across all platforms.
 * No external dependencies (tar command) required.
 */

/**
 * Parse TAR archive using pure JavaScript parser.
 *
 * @param {Buffer} tarBuffer - TAR archive data
 * @returns {Map<string, Buffer>} Map of filename to file content
 */
function parseTar(tarBuffer) {
  const {
    parseTar: parseTarJS,
  } = require('internal/socketsecurity/vfs/tar_parser')
  return parseTarJS(tarBuffer)
}

// Re-export helper functions from pure JS parser (lazy-loaded).
const {
  getDirectoryListing,
  isDirectory,
} = require('internal/socketsecurity/vfs/tar_parser')

// Lazy-load gzip support to avoid bootstrap zlib dependency
let tarGzipModule

function getTarGzipModule() {
  if (!tarGzipModule) {
    tarGzipModule = require('internal/socketsecurity/vfs/tar_gzip')
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
}
