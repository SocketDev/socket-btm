'use strict'

/**
 * TAR + GZIP support for Virtual Filesystem
 * Uses Node.js built-in zlib module for decompression
 */

const { gunzipSync } = require('node:zlib')

const { parseTar } = require('internal/socketsecurity_vfs/tar_parser')

/**
 * Parse gzipped TAR archive into a Map of filename -> Buffer
 *
 * @param {Buffer} gzipBuffer - Gzipped TAR archive data
 * @param {Object} options - Parsing options (passed to parseTar)
 * @returns {Map<string, Buffer>} Map of filename to file content
 */
function parseTarGzip(gzipBuffer, options = {}) {
  if (!Buffer.isBuffer(gzipBuffer)) {
    throw new TypeError('gzipBuffer must be a Buffer')
  }

  // Check gzip magic number (1f 8b)
  if (
    gzipBuffer.length < 2 ||
    gzipBuffer[0] !== 0x1f ||
    gzipBuffer[1] !== 0x8b
  ) {
    throw new Error('Invalid gzip format: magic number mismatch')
  }

  try {
    // Decompress gzip
    const tarBuffer = gunzipSync(gzipBuffer)

    // Parse TAR
    return parseTar(tarBuffer, options)
  } catch (err) {
    // Provide better error message
    if (err.code === 'Z_DATA_ERROR') {
      throw new Error('Gzip decompression failed: corrupted data')
    }
    if (err.code === 'Z_BUF_ERROR') {
      throw new Error('Gzip decompression failed: buffer error')
    }
    throw new Error(`Gzip decompression failed: ${err.message}`)
  }
}

/**
 * Auto-detect and parse TAR or TAR.GZ archive
 *
 * @param {Buffer} buffer - TAR or gzipped TAR archive
 * @param {Object} options - Parsing options
 * @returns {Map<string, Buffer>} Map of filename to file content
 */
function parseAuto(buffer, options = {}) {
  if (!Buffer.isBuffer(buffer)) {
    throw new TypeError('buffer must be a Buffer')
  }

  // Check if gzipped (magic number: 1f 8b)
  if (buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b) {
    if (process.env.NODE_DEBUG_VFS) {
      process._rawDebug('VFS: Detected gzip-compressed TAR archive')
    }
    return parseTarGzip(buffer, options)
  }

  // Otherwise assume uncompressed TAR
  if (process.env.NODE_DEBUG_VFS) {
    process._rawDebug('VFS: Detected uncompressed TAR archive')
  }
  return parseTar(buffer, options)
}

module.exports = {
  parseTarGzip,
  parseAuto,
}
