'use strict'

/**
 * Minimal TAR parser for Virtual Filesystem
 * Supports USTAR format (most common tar format)
 *
 * TAR format:
 * - 512-byte header followed by file data (rounded to 512-byte blocks)
 * - Header contains: filename, size, type, permissions, etc.
 */

const { ERR_INVALID_ARG_TYPE } = require('internal/errors').codes

// VFS directory marker - string constant instead of null
const VFS_DIRECTORY_MARKER = 'smol:vfs_directory'

// TAR header offsets
const HEADER_OFFSET = {
  // 100 bytes
  NAME: 0,
  // 8 bytes
  MODE: 100,
  // 8 bytes
  UID: 108,
  // 8 bytes
  GID: 116,
  // 12 bytes (octal)
  SIZE: 124,
  // 12 bytes (octal)
  MTIME: 136,
  // 8 bytes (octal)
  CHECKSUM: 148,
  // 1 byte
  TYPEFLAG: 156,
  // 100 bytes
  LINKNAME: 157,
  // 6 bytes ("ustar\0")
  MAGIC: 257,
  // 2 bytes
  VERSION: 263,
  // 32 bytes
  UNAME: 265,
  // 32 bytes
  GNAME: 297,
  // 155 bytes
  PREFIX: 345,
}

const HEADER_SIZE = 512
const BLOCK_SIZE = 512

// TAR file types
const TYPE = {
  FILE: '0',
  HARD_LINK: '1',
  SYMLINK: '2',
  CHAR_DEVICE: '3',
  BLOCK_DEVICE: '4',
  DIRECTORY: '5',
  FIFO: '6',
  // PAX extended header
  PAX_EXTENDED: 'x',
  // PAX global extended header
  PAX_GLOBAL: 'g',
  // GNU long link name
  GNU_LONGLINK: 'K',
  // GNU long file name
  GNU_LONGNAME: 'L',
}

/**
 * Calculate TAR header checksum
 */
function calculateChecksum(buffer, offset) {
  let sum = 0

  // Sum all bytes in header
  for (let i = 0; i < HEADER_SIZE; i++) {
    if (i >= HEADER_OFFSET.CHECKSUM && i < HEADER_OFFSET.CHECKSUM + 8) {
      // Checksum field itself is treated as spaces (ASCII 32)
      sum += 32
    } else {
      sum += buffer[offset + i]
    }
  }

  return sum
}

/**
 * Get directory listing from VFS
 */
function getDirectoryListing(vfsMap, dirPath) {
  // Normalize directory path
  let normalizedDir = dirPath.replace(/\\/g, '/')
  if (normalizedDir && !normalizedDir.endsWith('/')) {
    normalizedDir += '/'
  }

  const entries = []

  for (const [filepath] of vfsMap) {
    if (filepath.startsWith(normalizedDir) && filepath !== normalizedDir) {
      const relative = filepath.slice(normalizedDir.length)
      const parts = relative.split('/')

      // Only include direct children
      if (parts.length === 1 || (parts.length === 2 && parts[1] === '')) {
        const name = parts[0]
        if (name && !entries.includes(name)) {
          entries.push(name)
        }
      }
    }
  }

  return entries
}

/**
 * Check if path is a directory in VFS
 */
function isDirectory(vfsMap, filepath) {
  // Normalize path
  const normalized = filepath.replace(/\\/g, '/')

  // Check if path has trailing slash (explicit directory)
  if (normalized.endsWith('/')) {
    return (
      vfsMap.has(normalized) && vfsMap.get(normalized) === VFS_DIRECTORY_MARKER
    )
  }

  // Check if path with trailing slash exists
  const withSlash = `${normalized}/`
  if (vfsMap.has(withSlash) && vfsMap.get(withSlash) === VFS_DIRECTORY_MARKER) {
    return true
  }

  // Check if any files start with this path (implicit directory)
  const prefix = `${normalized}/`
  for (const key of vfsMap.keys()) {
    if (key.startsWith(prefix)) {
      return true
    }
  }

  return false
}

/**
 * Parse TAR header
 */
function parseHeader(buffer, offset, options = {}) {
  // Check for end of archive (all zeros)
  let allZero = true
  for (let i = 0; i < HEADER_SIZE; i++) {
    if (buffer[offset + i] !== 0) {
      allZero = false
      break
    }
  }

  if (allZero) {
    // End of archive
    return
  }

  const header = {
    name: parseString(buffer, offset + HEADER_OFFSET.NAME, 100),
    mode: parseOctal(buffer, offset + HEADER_OFFSET.MODE, 8),
    uid: parseOctal(buffer, offset + HEADER_OFFSET.UID, 8),
    gid: parseOctal(buffer, offset + HEADER_OFFSET.GID, 8),
    size: parseOctal(buffer, offset + HEADER_OFFSET.SIZE, 12),
    mtime: parseOctal(buffer, offset + HEADER_OFFSET.MTIME, 12),
    checksum: parseOctal(buffer, offset + HEADER_OFFSET.CHECKSUM, 8),
    typeflag: buffer.toString(
      'utf8',
      offset + HEADER_OFFSET.TYPEFLAG,
      offset + HEADER_OFFSET.TYPEFLAG + 1,
    ),
    linkname: parseString(buffer, offset + HEADER_OFFSET.LINKNAME, 100),
  }

  // Verify checksum if requested
  if (options.verifyChecksum !== false) {
    if (!verifyChecksum(buffer, offset, header.checksum)) {
      const actual = calculateChecksum(buffer, offset)
      throw new Error(
        `TAR checksum mismatch for "${header.name}": ` +
          `expected ${header.checksum}, got ${actual}`,
      )
    }
  }

  // Handle USTAR format (extended filename with prefix)
  const magic = parseString(buffer, offset + HEADER_OFFSET.MAGIC, 6)
  if (magic === 'ustar') {
    const prefix = parseString(buffer, offset + HEADER_OFFSET.PREFIX, 155)
    if (prefix) {
      header.name = `${prefix}/${header.name}`
    }
  } else if (magic && magic !== '') {
    // Unknown format
    if (options.strictFormat !== false) {
      throw new Error(`Unsupported TAR format magic: "${magic}"`)
    }
  }

  return header
}

/**
 * Parse octal string from buffer
 */
function parseOctal(buffer, offset, length) {
  // Remove null bytes and everything after
  const str = buffer
    .toString('utf8', offset, offset + length)
    .replace(/\0.*$/, '')
    .trim()

  if (str === '') {
    return 0
  }

  return Number.parseInt(str, 8)
}

/**
 * Parse PAX extended headers
 * Format: "LENGTH KEY=VALUE\n"
 * Example: "30 path=very/long/file/name.txt\n"
 */
function parsePaxExtended(buffer, offset, size) {
  const data = buffer.toString('utf8', offset, offset + size)
  const attrs = {}

  let pos = 0
  while (pos < data.length) {
    // Find the space after the length
    const spaceIdx = data.indexOf(' ', pos)
    if (spaceIdx === -1 || spaceIdx === pos) {
      break
    }

    // Parse length
    const lengthStr = data.substring(pos, spaceIdx)
    const length = Number.parseInt(lengthStr, 10)
    if (Number.isNaN(length) || length <= 0) {
      break
    }

    // Validate length doesn't exceed remaining data
    if (pos + length > data.length) {
      break
    }

    // Extract the record
    const record = data.substring(spaceIdx + 1, pos + length)
    const eqIdx = record.indexOf('=')
    if (eqIdx !== -1) {
      const key = record.substring(0, eqIdx)
      const value = record.substring(eqIdx + 1).replace(/\n$/, '')
      attrs[key] = value
    }

    pos += length
  }

  return attrs
}

/**
 * Parse null-terminated string from buffer
 */
function parseString(buffer, offset, length) {
  // Remove null bytes and everything after
  return buffer
    .toString('utf8', offset, offset + length)
    .replace(/\0.*$/, '')
    .trim()
}

/**
 * Parse TAR archive into a Map of filename -> Buffer
 *
 * @param {Buffer} tarBuffer - TAR archive data
 * @param {Object} options - Parsing options
 * @param {boolean} options.verifyChecksum - Verify header checksums (default: true)
 * @param {boolean} options.strictFormat - Strict format validation (default: false)
 * @returns {Map<string, Buffer>} Map of filename to file content
 */
function parseTar(tarBuffer, options = {}) {
  if (!Buffer.isBuffer(tarBuffer)) {
    throw new ERR_INVALID_ARG_TYPE('tarBuffer', 'Buffer', tarBuffer)
  }

  const files = new Map()
  let offset = 0
  // PAX extended attributes for next file
  let paxAttrs
  // GNU long filename for next file
  let gnuLongName
  // GNU long linkname for next file
  let gnuLongLink

  while (offset < tarBuffer.length) {
    // Check if we have enough data for a header
    if (offset + HEADER_SIZE > tarBuffer.length) {
      if (options.strictFormat !== false) {
        throw new Error(
          `Truncated TAR archive: expected header at offset ${offset}`,
        )
      }
      break
    }

    // Parse header
    let header
    try {
      header = parseHeader(tarBuffer, offset, options)
    } catch (err) {
      // Re-throw with better context
      err.message = `Failed to parse TAR header at offset ${offset}: ${err.message}`
      throw err
    }

    if (header === undefined) {
      // End of archive
      break
    }

    offset += HEADER_SIZE

    // Check for data overflow
    if (offset + header.size > tarBuffer.length) {
      throw new Error(
        `Truncated TAR archive: file "${header.name}" claims ${header.size} bytes ` +
          `but only ${tarBuffer.length - offset} bytes remaining`,
      )
    }

    // Handle PAX extended headers
    if (header.typeflag === TYPE.PAX_EXTENDED) {
      paxAttrs = parsePaxExtended(tarBuffer, offset, header.size)

      // Move past PAX data
      const blocksNeeded = Math.ceil(header.size / BLOCK_SIZE)
      offset += blocksNeeded * BLOCK_SIZE
      continue
    }

    // Handle PAX global headers (skip for now)
    if (header.typeflag === TYPE.PAX_GLOBAL) {
      const blocksNeeded = Math.ceil(header.size / BLOCK_SIZE)
      offset += blocksNeeded * BLOCK_SIZE
      continue
    }

    // Handle GNU long filename
    if (header.typeflag === TYPE.GNU_LONGNAME) {
      gnuLongName = tarBuffer
        .toString('utf8', offset, offset + header.size)
        .replace(/\0.*$/, '')

      const blocksNeeded = Math.ceil(header.size / BLOCK_SIZE)
      offset += blocksNeeded * BLOCK_SIZE
      continue
    }

    // Handle GNU long linkname
    if (header.typeflag === TYPE.GNU_LONGLINK) {
      gnuLongLink = tarBuffer
        .toString('utf8', offset, offset + header.size)
        .replace(/\0.*$/, '')

      const blocksNeeded = Math.ceil(header.size / BLOCK_SIZE)
      offset += blocksNeeded * BLOCK_SIZE
      continue
    }

    // Apply PAX attributes if present
    if (paxAttrs) {
      if (paxAttrs.path) {
        header.name = paxAttrs.path
      }
      if (paxAttrs.linkpath) {
        header.linkname = paxAttrs.linkpath
      }
      if (paxAttrs.size) {
        header.size = Number.parseInt(paxAttrs.size, 10)
      }
      // Clear for next file
      paxAttrs = undefined
    }

    // Apply GNU long names if present
    if (gnuLongName) {
      header.name = gnuLongName
      gnuLongName = undefined
    }
    if (gnuLongLink) {
      header.linkname = gnuLongLink
      gnuLongLink = undefined
    }

    // Extract file data
    if (
      header.typeflag === TYPE.FILE ||
      header.typeflag === '0' ||
      header.typeflag === ''
    ) {
      if (header.size > 0) {
        const content = tarBuffer.slice(offset, offset + header.size)
        files.set(header.name, content)
      } else {
        // Empty file
        files.set(header.name, Buffer.alloc(0))
      }
    } else if (header.typeflag === TYPE.DIRECTORY) {
      // Store directory entry (marker string)
      files.set(header.name, VFS_DIRECTORY_MARKER)
    } else if (header.typeflag === TYPE.SYMLINK) {
      // Store symlink info (linkname as string)
      files.set(header.name, Buffer.from(header.linkname, 'utf8'))
    } else if (header.typeflag === TYPE.HARD_LINK) {
      // Store hard link info (linkname as string, same as symlink)
      files.set(header.name, Buffer.from(header.linkname, 'utf8'))
    } else {
      // Unknown type - skip if not strict
      if (options.strictFormat !== false) {
        throw new Error(
          `Unsupported TAR entry type "${header.typeflag}" for "${header.name}"`,
        )
      }
    }

    // Move to next block (round up to 512-byte boundary)
    const blocksNeeded = Math.ceil(header.size / BLOCK_SIZE)
    offset += blocksNeeded * BLOCK_SIZE
  }

  return files
}

/**
 * Verify TAR header checksum
 */
function verifyChecksum(buffer, offset, expectedChecksum) {
  if (expectedChecksum === 0) {
    // Empty or uninitialized header
    return true
  }

  const actualChecksum = calculateChecksum(buffer, offset)
  return actualChecksum === expectedChecksum
}

module.exports = {
  getDirectoryListing,
  isDirectory,
  parseTar,
  VFS_DIRECTORY_MARKER,
}
