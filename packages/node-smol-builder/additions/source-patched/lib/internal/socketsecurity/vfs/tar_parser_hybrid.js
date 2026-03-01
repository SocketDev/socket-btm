'use strict'

/**
 * TAR parser for Virtual Filesystem
 *
 * Uses pure JavaScript TAR parser for consistent behavior across all platforms.
 * No external dependencies (tar command) required.
 */

// Use primordials for protection against prototype pollution
const { ObjectFreeze, ReflectApply } = primordials

const { createLazyLoader } = require('internal/socketsecurity/safe-references')

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
const getTarGzipModule = createLazyLoader(
  'internal/socketsecurity/vfs/tar_gzip',
)

module.exports = ObjectFreeze({
  parseTar,
  // Lazy-load gzip functions using ReflectApply for safety
  parseTarGzip(buffer, options) {
    return ReflectApply(getTarGzipModule().parseTarGzip, undefined, [
      buffer,
      options,
    ])
  },
  parseAuto(buffer, options) {
    return ReflectApply(getTarGzipModule().parseAuto, undefined, [
      buffer,
      options,
    ])
  },
  getDirectoryListing,
  isDirectory,
})
