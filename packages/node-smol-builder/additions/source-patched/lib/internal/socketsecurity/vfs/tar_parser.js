'use strict'

/**
 * Minimal TAR parser for Virtual Filesystem
 * Supports USTAR format (most common tar format)
 *
 * TAR format:
 * - 512-byte header followed by file data (rounded to 512-byte blocks)
 * - Header contains: filename, size, type, permissions, etc.
 *
 * VFS Entry Structure:
 * Each entry in the VFS map is an object with:
 * - type: 'file' | 'directory' | 'symlink'
 * - mode: File permissions (octal, e.g., 0o755 for executables, 0o644 for regular files)
 * - content: Buffer (for files), undefined (for directories)
 * - linkTarget: string (for symlinks only)
 */

const { ERR_INVALID_ARG_TYPE } = require('internal/errors').codes
const {
  ArrayPrototypePush,
  BufferIsBuffer,
  Error: ErrorConstructor,
  MapPrototypeForEach,
  MapPrototypeGet,
  MapPrototypeSet,
  MathCeil,
  NumberIsNaN,
  NumberParseInt,
  ObjectFreeze,
  SafeMap,
  SafeSet,
  SetPrototypeAdd,
  SetPrototypeHas,
  StringPrototypeEndsWith,
  StringPrototypeIndexOf,
  StringPrototypeReplace,
  StringPrototypeSlice,
  StringPrototypeSplit,
  StringPrototypeStartsWith,
  StringPrototypeSubstring,
  StringPrototypeTrim,
} = primordials
// Use safe references for Buffer methods (defense against tampering)
const {
  BufferAlloc,
  BufferPrototypeSlice,
  BufferPrototypeToString,
  NULL_SUFFIX_REGEX,
  TRAILING_NEWLINE_REGEX,
  normalizePath,
} = require('internal/socketsecurity/safe-references')

// VFS directory marker - string constant for directory identification
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
 * Results are cached per directory path for O(1) repeated lookups
 */
function getDirectoryListing(vfsMap, dirPath) {
  // Normalize directory path
  let normalizedDir = normalizePath(dirPath)
  if (normalizedDir && !StringPrototypeEndsWith(normalizedDir, '/')) {
    normalizedDir += '/'
  }

  // Check cache first
  if (directoryListingCache) {
    const cached = MapPrototypeGet(directoryListingCache, normalizedDir)
    if (cached !== undefined) {
      return cached
    }
  } else {
    // Initialize cache on first use
    directoryListingCache = new SafeMap()
  }

  const entries = []
  // Use Set for O(1) deduplication instead of O(n) ArrayPrototypeIncludes
  const seen = new SafeSet()

  // Use MapPrototypeForEach to avoid Symbol.iterator pollution
  MapPrototypeForEach(vfsMap, (_, filepath) => {
    if (
      filepath !== normalizedDir &&
      StringPrototypeStartsWith(filepath, normalizedDir)
    ) {
      const relative = StringPrototypeSlice(filepath, normalizedDir.length)
      const parts = StringPrototypeSplit(relative, '/')

      // Only include direct children
      if (parts.length === 1 || (parts.length === 2 && parts[1] === '')) {
        const name = parts[0]
        if (name && !SetPrototypeHas(seen, name)) {
          SetPrototypeAdd(seen, name)
          ArrayPrototypePush(entries, name)
        }
      }
    }
  })

  // Cache the result
  MapPrototypeSet(directoryListingCache, normalizedDir, entries)

  return entries
}

// Cache for implicit directories (built lazily on first isDirectory call)
let implicitDirsCache

// Cache for directory listings (built lazily per directory path)
let directoryListingCache

/**
 * Build index of implicit directories from VFS map
 * An implicit directory is any path prefix of a file that isn't explicitly stored
 */
function buildImplicitDirsIndex(vfsMap) {
  const dirs = new SafeSet()

  // Use MapPrototypeForEach to avoid Symbol.iterator pollution
  MapPrototypeForEach(vfsMap, (_, filepath) => {
    // Extract all parent directories from this path
    let lastSlash = StringPrototypeIndexOf(filepath, '/')
    while (lastSlash !== -1) {
      const dir = StringPrototypeSlice(filepath, 0, lastSlash + 1)
      SetPrototypeAdd(dirs, dir)
      lastSlash = StringPrototypeIndexOf(filepath, '/', lastSlash + 1)
    }
  })

  return dirs
}

/**
 * Check if path is a directory in VFS
 * Uses cached index for O(1) lookup instead of O(n) scan
 */
function isDirectory(vfsMap, filepath) {
  // Normalize path
  const normalized = normalizePath(filepath)

  // Ensure path has trailing slash for directory lookup
  const withSlash = StringPrototypeEndsWith(normalized, '/')
    ? normalized
    : `${normalized}/`

  // Check if explicitly stored as directory
  const entry = MapPrototypeGet(vfsMap, withSlash)
  if (entry?.type === 'directory') {
    return true
  }

  // Check implicit directories cache (built lazily)
  if (implicitDirsCache === undefined) {
    implicitDirsCache = buildImplicitDirsIndex(vfsMap)
  }

  return SetPrototypeHas(implicitDirsCache, withSlash)
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

  // Parse mode field - distinguish between empty (undefined) and 0o000
  const modeStr = StringPrototypeTrim(
    StringPrototypeReplace(
      BufferPrototypeToString(
        buffer,
        'utf8',
        offset + HEADER_OFFSET.MODE,
        offset + HEADER_OFFSET.MODE + 8,
      ),
      NULL_SUFFIX_REGEX,
      '',
    ),
  )

  // Parse size first for validation
  const size = parseOctal(buffer, offset + HEADER_OFFSET.SIZE, 12)

  // Security: Validate size to prevent DoS via excessive memory allocation
  // Max 2GB per file (0x7FFFFFFF = 2147483647 bytes)
  if (size < 0 || size > 0x7f_ff_ff_ff) {
    throw new ErrorConstructor(
      `TAR security error: Invalid file size ${size} bytes\n` +
        '  Maximum allowed: 2GB (2147483647 bytes)\n' +
        '  This may indicate a malicious or corrupted archive',
    )
  }

  const header = {
    name: parseString(buffer, offset + HEADER_OFFSET.NAME, 100),
    mode:
      modeStr === ''
        ? undefined
        : parseOctal(buffer, offset + HEADER_OFFSET.MODE, 8),
    uid: parseOctal(buffer, offset + HEADER_OFFSET.UID, 8),
    gid: parseOctal(buffer, offset + HEADER_OFFSET.GID, 8),
    size,
    mtime: parseOctal(buffer, offset + HEADER_OFFSET.MTIME, 12),
    checksum: parseOctal(buffer, offset + HEADER_OFFSET.CHECKSUM, 8),
    typeflag: BufferPrototypeToString(
      buffer,
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
      throw new ErrorConstructor(
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
      throw new ErrorConstructor(`Unsupported TAR format magic: "${magic}"`)
    }
  }

  return header
}

/**
 * Parse octal string from buffer
 */
function parseOctal(buffer, offset, length) {
  // Remove null bytes and everything after
  const str = StringPrototypeTrim(
    StringPrototypeReplace(
      BufferPrototypeToString(buffer, 'utf8', offset, offset + length),
      NULL_SUFFIX_REGEX,
      '',
    ),
  )

  if (str === '') {
    return 0
  }

  return NumberParseInt(str, 8)
}

/**
 * Parse PAX extended headers
 * Format: "LENGTH KEY=VALUE\n"
 * Example: "30 path=very/long/file/name.txt\n"
 */
function parsePaxExtended(buffer, offset, size) {
  const data = BufferPrototypeToString(buffer, 'utf8', offset, offset + size)
  const attrs = {}

  let pos = 0
  while (pos < data.length) {
    // Find the space after the length
    const spaceIdx = StringPrototypeIndexOf(data, ' ', pos)
    if (spaceIdx === -1 || spaceIdx === pos) {
      break
    }

    // Parse length
    const lengthStr = StringPrototypeSubstring(data, pos, spaceIdx)
    const length = NumberParseInt(lengthStr, 10)
    // Security: Validate PAX record length (max 1MB per record to prevent DoS)
    if (NumberIsNaN(length) || length <= 0 || length > 1_048_576) {
      break
    }

    // Validate length doesn't exceed remaining data
    if (pos + length > data.length) {
      break
    }

    // Extract the record
    const record = StringPrototypeSubstring(data, spaceIdx + 1, pos + length)
    const eqIdx = StringPrototypeIndexOf(record, '=')
    if (eqIdx !== -1 && eqIdx > 0) {
      const key = StringPrototypeSubstring(record, 0, eqIdx)
      const value = StringPrototypeReplace(
        StringPrototypeSubstring(record, eqIdx + 1),
        TRAILING_NEWLINE_REGEX,
        '',
      )
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
  return StringPrototypeTrim(
    StringPrototypeReplace(
      BufferPrototypeToString(buffer, 'utf8', offset, offset + length),
      NULL_SUFFIX_REGEX,
      '',
    ),
  )
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
  if (!BufferIsBuffer(tarBuffer)) {
    throw new ERR_INVALID_ARG_TYPE('tarBuffer', 'Buffer', tarBuffer)
  }

  // Invalidate caches when parsing new TAR
  implicitDirsCache = undefined
  directoryListingCache = undefined

  const files = new SafeMap()
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
        throw new ErrorConstructor(
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
      throw new ErrorConstructor(
        `Truncated TAR archive: file "${header.name}" claims ${header.size} bytes ` +
          `but only ${tarBuffer.length - offset} bytes remaining`,
      )
    }

    // Handle PAX extended headers
    if (header.typeflag === TYPE.PAX_EXTENDED) {
      paxAttrs = parsePaxExtended(tarBuffer, offset, header.size)

      // Move past PAX data
      const blocksNeeded = MathCeil(header.size / BLOCK_SIZE)
      offset += blocksNeeded * BLOCK_SIZE
      continue
    }

    // Handle PAX global headers (skip for now)
    if (header.typeflag === TYPE.PAX_GLOBAL) {
      const blocksNeeded = MathCeil(header.size / BLOCK_SIZE)
      offset += blocksNeeded * BLOCK_SIZE
      continue
    }

    // Handle GNU long filename
    if (header.typeflag === TYPE.GNU_LONGNAME) {
      gnuLongName = StringPrototypeReplace(
        BufferPrototypeToString(
          tarBuffer,
          'utf8',
          offset,
          offset + header.size,
        ),
        NULL_SUFFIX_REGEX,
        '',
      )

      const blocksNeeded = MathCeil(header.size / BLOCK_SIZE)
      offset += blocksNeeded * BLOCK_SIZE
      continue
    }

    // Handle GNU long linkname
    if (header.typeflag === TYPE.GNU_LONGLINK) {
      gnuLongLink = StringPrototypeReplace(
        BufferPrototypeToString(
          tarBuffer,
          'utf8',
          offset,
          offset + header.size,
        ),
        NULL_SUFFIX_REGEX,
        '',
      )

      const blocksNeeded = MathCeil(header.size / BLOCK_SIZE)
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
        const parsedSize = NumberParseInt(paxAttrs.size, 10)
        if (!NumberIsNaN(parsedSize)) {
          header.size = parsedSize
        }
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

    // Normalize entry names: strip leading './' prefix
    // TAR archives created with 'tar cf ... -C dir .' have entries like './file'
    // but VFS lookups expect 'file' without the './' prefix
    if (StringPrototypeStartsWith(header.name, './')) {
      header.name = StringPrototypeSlice(header.name, 2)
    }
    if (header.linkname && StringPrototypeStartsWith(header.linkname, './')) {
      header.linkname = StringPrototypeSlice(header.linkname, 2)
    }

    // Skip root directory entry (empty name or just '.')
    // Some TAR archives include '.' as the first entry
    if (header.name === '' || header.name === '.') {
      const blocksNeeded = MathCeil(header.size / BLOCK_SIZE)
      offset += blocksNeeded * BLOCK_SIZE
      continue
    }

    // Extract file data with metadata (type and mode)
    if (
      header.typeflag === TYPE.FILE ||
      header.typeflag === '0' ||
      header.typeflag === ''
    ) {
      const content =
        header.size > 0
          ? BufferPrototypeSlice(tarBuffer, offset, offset + header.size)
          : BufferAlloc(0)

      MapPrototypeSet(files, header.name, {
        type: 'file',
        mode: header.mode !== undefined ? header.mode : 0o644,
        content,
      })
    } else if (header.typeflag === TYPE.DIRECTORY) {
      // Store directory entry with metadata
      MapPrototypeSet(files, header.name, {
        type: 'directory',
        mode: header.mode !== undefined ? header.mode : 0o755,
      })
    } else if (header.typeflag === TYPE.SYMLINK) {
      // Store symlink with metadata
      MapPrototypeSet(files, header.name, {
        type: 'symlink',
        mode: 0o777,
        linkTarget: header.linkname,
      })
    } else if (header.typeflag === TYPE.HARD_LINK) {
      // Hard links should copy content from target (not symlink behavior)
      const targetEntry = MapPrototypeGet(files, header.linkname)
      if (targetEntry && targetEntry.type === 'file') {
        // Copy content and mode from target
        MapPrototypeSet(files, header.name, {
          type: 'file',
          mode: targetEntry.mode,
          content: targetEntry.content,
        })
      } else {
        // Target not found or not a file - treat as broken hard link
        // Store as zero-length file with default permissions
        MapPrototypeSet(files, header.name, {
          type: 'file',
          mode: 0o644,
          content: BufferAlloc(0),
        })
      }
    } else {
      // Unknown type - skip if not strict
      if (options.strictFormat !== false) {
        throw new ErrorConstructor(
          `Unsupported TAR entry type "${header.typeflag}" for "${header.name}"`,
        )
      }
    }

    // Move to next block (round up to 512-byte boundary)
    const blocksNeeded = MathCeil(header.size / BLOCK_SIZE)
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

/**
 * Get content from VFS entry
 * Returns Buffer for files, VFS_DIRECTORY_MARKER for directories
 */
function getContent(entry) {
  if (!entry) {
    return undefined
  }

  if (entry.type === 'directory') {
    return VFS_DIRECTORY_MARKER
  }
  return entry.content
}

/**
 * Get mode from VFS entry
 * Returns file permissions from TAR metadata
 */
function getMode(entry) {
  if (!entry) {
    return undefined
  }
  return entry.mode
}

module.exports = ObjectFreeze({
  getContent,
  getDirectoryListing,
  getMode,
  isDirectory,
  parseTar,
  VFS_DIRECTORY_MARKER,
})
