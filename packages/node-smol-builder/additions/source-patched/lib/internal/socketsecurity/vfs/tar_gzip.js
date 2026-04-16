'use strict'

/**
 * TAR + GZIP support for Virtual Filesystem
 * Uses GunzipSync from safe-references for decompression
 */

const {
  BufferIsBuffer,
  GunzipSync,
  ProcessEnv,
  ProcessRawDebug,
} = require('internal/socketsecurity/safe-references')
const { parseTar } = require('internal/socketsecurity/vfs/tar_parser')

// Use primordials for protection against prototype pollution
const {
  Error: ErrorConstructor,
  ObjectFreeze,
  TypeError: TypeErrorConstructor,
} = primordials

/**
 * Parse gzipped TAR archive into a Map of filename -> Buffer
 *
 * @param {Buffer} gzipBuffer - Gzipped TAR archive data
 * @param {Object} options - Parsing options (passed to parseTar)
 * @returns {Map<string, Buffer>} Map of filename to file content
 */
function parseTarGzip(gzipBuffer, options) {
  const opts = { __proto__: null, ...options }
  if (!BufferIsBuffer(gzipBuffer)) {
    throw new TypeErrorConstructor('gzipBuffer must be a Buffer')
  }

  // Check gzip magic number (1f 8b)
  if (
    gzipBuffer.length < 2 ||
    gzipBuffer[0] !== 0x1f ||
    gzipBuffer[1] !== 0x8b
  ) {
    throw new ErrorConstructor('Invalid gzip format: magic number mismatch')
  }

  try {
    // Decompress gzip
    const tarBuffer = GunzipSync(gzipBuffer)

    // Parse TAR
    return parseTar(tarBuffer, opts)
  } catch (error) {
    // Provide better error message
    if (error.code === 'Z_DATA_ERROR') {
      throw new ErrorConstructor('Gzip decompression failed: corrupted data')
    }
    if (error.code === 'Z_BUF_ERROR') {
      throw new ErrorConstructor('Gzip decompression failed: buffer error')
    }
    throw new ErrorConstructor(`Gzip decompression failed: ${error.message}`)
  }
}

/**
 * Auto-detect and parse TAR or TAR.GZ archive
 *
 * @param {Buffer} buffer - TAR or gzipped TAR archive
 * @param {Object} options - Parsing options
 * @returns {Map<string, Buffer>} Map of filename to file content
 */
function parseAuto(buffer, options) {
  const opts = { __proto__: null, ...options }
  if (!BufferIsBuffer(buffer)) {
    throw new TypeErrorConstructor('buffer must be a Buffer')
  }

  // Check if gzipped (magic number: 1f 8b)
  if (buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b) {
    if (ProcessEnv.NODE_DEBUG_VFS) {
      ProcessRawDebug('VFS: Detected gzip-compressed TAR archive')
    }
    return parseTarGzip(buffer, opts)
  }

  // Otherwise assume uncompressed TAR
  if (ProcessEnv.NODE_DEBUG_VFS) {
    ProcessRawDebug('VFS: Detected uncompressed TAR archive')
  }
  return parseTar(buffer, opts)
}

module.exports = ObjectFreeze({
  __proto__: null,
  parseAuto,
  parseTarGzip,
})
