'use strict'

// Documentation: docs/additions/lib/internal/socketsecurity/vfs/tar_parser.js.md

const { ERR_INVALID_ARG_TYPE } = require('internal/errors').codes

// Native binding for SIMD-accelerated TAR operations (lazy)
let _vfsBinding
function getVfsBinding() {
  if (!_vfsBinding) _vfsBinding = internalBinding('smol_vfs')
  return _vfsBinding
}
const {
  ArrayPrototypePush,
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
  SetPrototypeForEach,
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
  BufferIsBuffer,
  BufferPrototypeSlice,
  BufferPrototypeToString,
  NULL_SUFFIX_REGEX,
  TRAILING_NEWLINE_REGEX,
  normalizePath,
} = require('internal/socketsecurity/safe-references')

// Lazy content materialization threshold.
// Files at or below this size are copied eagerly (cheap).
// Files above this size store offset/length and slice on demand (zero-copy init).
const LAZY_CONTENT_THRESHOLD = 256

// VFS directory marker - string constant for directory identification
const VFS_DIRECTORY_MARKER = 'smol:vfs_directory'

// TAR header offsets
const HEADER_OFFSET = {
  __proto__: null,
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
  __proto__: null,
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
 * Uses SIMD-accelerated native binding for 50-100x speedup on large archives
 */
function calculateChecksum(buffer, offset) {
  // Use SIMD-accelerated native implementation
  return getVfsBinding().tarCalculateChecksum(buffer, offset)
}

/**
 * Build complete directory index from VFS map (single O(n) pass)
 * Creates a Map where each key is a directory path and value is array of direct children
 */
function buildDirectoryIndex(vfsMap) {
  const dirIndex = new SafeMap()

  // Use MapPrototypeForEach to avoid Symbol.iterator pollution
  MapPrototypeForEach(vfsMap, (_, filepath) => {
    // Check if path has any slashes (first slash position)
    const firstSlash = StringPrototypeIndexOf(filepath, '/')

    // If no slash, this is a root-level entry
    if (firstSlash === -1) {
      // Add to root directory (empty string key represents root)
      let rootChildren = MapPrototypeGet(dirIndex, '')
      if (!rootChildren) {
        rootChildren = new SafeSet()
        MapPrototypeSet(dirIndex, '', rootChildren)
      }
      SetPrototypeAdd(rootChildren, filepath)
    } else {
      // Extract all parent directories and build the index
      let pos = 0
      while (pos < filepath.length) {
        const slashPos = StringPrototypeIndexOf(filepath, '/', pos)
        if (slashPos === -1) {
          // No more slashes - this is the final component (file or dir name)
          // Parent is everything before this component
          const parentDir = StringPrototypeSlice(filepath, 0, pos)
          const entryName = StringPrototypeSlice(filepath, pos)
          // Skip empty entry names (trailing slashes)
          if (entryName) {
            let children = MapPrototypeGet(dirIndex, parentDir)
            if (!children) {
              children = new SafeSet()
              MapPrototypeSet(dirIndex, parentDir, children)
            }
            SetPrototypeAdd(children, entryName)
          }
          break
        } else {
          // Found a slash - add this directory level
          const dirPath = StringPrototypeSlice(filepath, 0, slashPos + 1)
          const entryName = StringPrototypeSlice(filepath, pos, slashPos)
          // Add this entry to its parent
          const parentDir =
            pos === 0 ? '' : StringPrototypeSlice(filepath, 0, pos)
          if (entryName) {
            let children = MapPrototypeGet(dirIndex, parentDir)
            if (!children) {
              children = new SafeSet()
              MapPrototypeSet(dirIndex, parentDir, children)
            }
            // Add with trailing slash if it's a directory
            SetPrototypeAdd(children, entryName + '/')
          }
          pos = slashPos + 1
        }
      }
    }
  })

  // Convert Sets to frozen Arrays for immutability and faster iteration
  const result = new SafeMap()
  MapPrototypeForEach(dirIndex, (childSet, dirPath) => {
    const arr = []
    SetPrototypeForEach(childSet, name => {
      // Strip trailing slash for directory names in listing
      ArrayPrototypePush(
        arr,
        StringPrototypeEndsWith(name, '/')
          ? StringPrototypeSlice(name, 0, -1)
          : name,
      )
    })
    MapPrototypeSet(result, dirPath, arr)
  })

  return result
}

/**
 * Get directory listing from VFS
 * Uses pre-built directory index for O(1) lookup
 */
function getDirectoryListing(vfsMap, dirPath) {
  // Normalize directory path
  let normalizedDir = normalizePath(dirPath)
  if (normalizedDir && !StringPrototypeEndsWith(normalizedDir, '/')) {
    normalizedDir += '/'
  }

  // Build complete directory index on first access (single O(n) pass)
  if (!directoryListingCache) {
    directoryListingCache = buildDirectoryIndex(vfsMap)
  }

  // O(1) lookup
  const entries = MapPrototypeGet(directoryListingCache, normalizedDir)
  return entries ?? []
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

  // Special case: root directory ('' or '/') is always a directory if VFS has entries
  // This enables glob to traverse from '/snapshot' into the VFS
  if (normalized === '' || normalized === '/') {
    return vfsMap.size > 0
  }

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
  // Check for end of archive (all zeros) - SIMD accelerated
  if (getVfsBinding().tarIsZeroBlock(buffer, offset)) {
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
  // Max 2GB per file (0x7FFFFFFF = 2147483647 bytes).
  // parseOctal returns NaN for malformed fields; NaN slips both <0 and >max
  // comparisons, so reject NaN explicitly.
  if (NumberIsNaN(size) || size < 0 || size > 0x7f_ff_ff_ff) {
    throw new ErrorConstructor(
      `TAR security error: Invalid file size ${size} bytes\n` +
        '  Maximum allowed: 2GB (2147483647 bytes)\n' +
        '  This may indicate a malicious or corrupted archive',
    )
  }

  const header = {
    __proto__: null,
    checksum: parseOctal(buffer, offset + HEADER_OFFSET.CHECKSUM, 8),
    gid: parseOctal(buffer, offset + HEADER_OFFSET.GID, 8),
    linkname: parseString(buffer, offset + HEADER_OFFSET.LINKNAME, 100),
    mode:
      modeStr === ''
        ? undefined
        : parseOctal(buffer, offset + HEADER_OFFSET.MODE, 8),
    mtime: parseOctal(buffer, offset + HEADER_OFFSET.MTIME, 12),
    name: parseString(buffer, offset + HEADER_OFFSET.NAME, 100),
    size,
    typeflag: BufferPrototypeToString(
      buffer,
      'utf8',
      offset + HEADER_OFFSET.TYPEFLAG,
      offset + HEADER_OFFSET.TYPEFLAG + 1,
    ),
    uid: parseOctal(buffer, offset + HEADER_OFFSET.UID, 8),
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
    if (options.strictFormat === true) {
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
  const attrs = { __proto__: null }

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

    // Validate record bounds: content starts after space, must be before end of record
    // A valid record needs at least: "N k=v\n" where N is length, k is key, v is value
    // spaceIdx + 1 is where content starts, pos + length is where next record starts
    if (spaceIdx + 1 >= pos + length) {
      // Malformed record: no content after space, skip to next
      break
    }

    // Extract the record (from after space to end of record, excluding trailing newline)
    const record = StringPrototypeSubstring(
      data,
      spaceIdx + 1,
      pos + length - 1,
    )
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
      if (options.strictFormat === true) {
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
    } catch (error) {
      // Re-throw with better context
      error.message = `Failed to parse TAR header at offset ${offset}: ${error.message}`
      throw error
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
          // Re-apply the 2GB DoS guard from parseHeader. A malicious tarball
          // can present a small USTAR size and a huge PAX size override.
          if (parsedSize < 0 || parsedSize > 0x7f_ff_ff_ff) {
            throw new ErrorConstructor(
              `TAR security error: Invalid PAX size ${parsedSize} bytes\n` +
                '  Maximum allowed: 2GB (2147483647 bytes)\n' +
                '  This may indicate a malicious or corrupted archive',
            )
          }
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
      // Zero-copy optimization: large files store offset/length into the
      // source tarBuffer and materialize a Buffer view on first access via
      // getContent(). Small files (<=LAZY_CONTENT_THRESHOLD) are copied
      // eagerly since the copy cost is negligible and avoids indirection.
      let entry
      if (header.size === 0) {
        entry = {
          __proto__: null,
          content: BufferAlloc(0),
          mode: header.mode !== undefined ? header.mode : 0o644,
          type: 'file',
        }
      } else if (header.size <= LAZY_CONTENT_THRESHOLD) {
        entry = {
          __proto__: null,
          content: BufferPrototypeSlice(
            tarBuffer,
            offset,
            offset + header.size,
          ),
          mode: header.mode !== undefined ? header.mode : 0o644,
          type: 'file',
        }
      } else {
        entry = {
          __proto__: null,
          _bufferOffset: offset,
          _bufferLength: header.size,
          _sourceBuffer: tarBuffer,
          content: undefined,
          mode: header.mode !== undefined ? header.mode : 0o644,
          type: 'file',
        }
      }

      MapPrototypeSet(files, header.name, entry)
    } else if (header.typeflag === TYPE.DIRECTORY) {
      // Store directory entry with metadata
      MapPrototypeSet(files, header.name, {
        __proto__: null,
        mode: header.mode !== undefined ? header.mode : 0o755,
        type: 'directory',
      })
    } else if (header.typeflag === TYPE.SYMLINK) {
      // Store symlink with metadata
      MapPrototypeSet(files, header.name, {
        __proto__: null,
        linkTarget: header.linkname,
        mode: 0o777,
        type: 'symlink',
      })
    } else if (header.typeflag === TYPE.HARD_LINK) {
      // Hard links should copy content from target (not symlink behavior)
      const targetEntry = MapPrototypeGet(files, header.linkname)
      if (targetEntry && targetEntry.type === 'file') {
        // Share content reference from target (uses getContent() for lazy entries)
        const targetContent = getContent(targetEntry)
        MapPrototypeSet(files, header.name, {
          __proto__: null,
          content: targetContent,
          mode: targetEntry.mode,
          type: 'file',
        })
      } else {
        // Target not found or not a file - treat as broken hard link
        // Store as zero-length file with default permissions
        MapPrototypeSet(files, header.name, {
          __proto__: null,
          content: BufferAlloc(0),
          mode: 0o644,
          type: 'file',
        })
      }
    } else {
      // Unknown type - skip if not strict
      if (options.strictFormat === true) {
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
 * Get content from VFS entry.
 * Returns Buffer for files, VFS_DIRECTORY_MARKER for directories.
 * For zero-copy entries (large files), materializes a Buffer view on first
 * access and caches it on the entry for subsequent reads.
 */
function getContent(entry) {
  if (!entry) {
    return undefined
  }

  if (entry.type === 'directory') {
    return VFS_DIRECTORY_MARKER
  }

  // Fast path: content already materialized (small files or repeated access)
  if (entry.content !== undefined) {
    return entry.content
  }

  // Lazy materialization: create a view into the source tarBuffer
  if (entry._sourceBuffer !== undefined) {
    const content = BufferPrototypeSlice(
      entry._sourceBuffer,
      entry._bufferOffset,
      entry._bufferOffset + entry._bufferLength,
    )
    // Cache on the entry so subsequent reads are free.
    // Release the reference to the source buffer fields to allow GC
    // if all entries from this tar have been materialized.
    entry.content = content
    entry._sourceBuffer = undefined
    entry._bufferOffset = undefined
    entry._bufferLength = undefined
    return content
  }

  return undefined
}

/**
 * Get file size from VFS entry without materializing content.
 * For lazy entries, returns the stored buffer length directly,
 * avoiding unnecessary buffer allocation just to check size.
 */
function getFileSize(entry) {
  if (!entry || entry.type === 'directory') {
    return 0
  }
  // Lazy entry: size available without materialization
  if (entry._bufferLength !== undefined) {
    return entry._bufferLength
  }
  // Eagerly materialized entry
  if (entry.content !== undefined) {
    return entry.content.length
  }
  return 0
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
  __proto__: null,
  VFS_DIRECTORY_MARKER,
  getContent,
  getDirectoryListing,
  getFileSize,
  getMode,
  isDirectory,
  parseTar,
})
