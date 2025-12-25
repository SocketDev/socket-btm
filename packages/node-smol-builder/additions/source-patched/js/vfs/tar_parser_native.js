/**
 * Native TAR parser for Virtual Filesystem
 * Uses system tar command for better performance and compatibility
 */

const { spawnSync } = require('node:child_process')
const {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync: _statSync,
  writeFileSync,
} = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')

const { ERR_INVALID_ARG_TYPE } = require('internal/errors').codes

// Cache the native tar availability check
let useNative = null

/**
 * Check if native tar is available
 * @returns {boolean} True if native tar command is available
 */
function hasNativeTar() {
  if (useNative !== null) {
    return useNative
  }

  try {
    const result = spawnSync('tar', ['--version'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 1000,
    })

    useNative = result.status === 0
  } catch {
    useNative = false
  }

  if (process.env.NODE_DEBUG_VFS && useNative) {
    process._rawDebug('VFS: Native tar available')
  }

  return useNative
}

/**
 * Parse TAR archive into a Map of filename -> Buffer using native tar
 *
 * @param {Buffer} tarBuffer - TAR archive data
 * @returns {Map<string, Buffer>} Map of filename to file content
 */
function parseTar(tarBuffer) {
  if (!Buffer.isBuffer(tarBuffer)) {
    throw new ERR_INVALID_ARG_TYPE('tarBuffer', 'Buffer', tarBuffer)
  }

  // Create temp directory for extraction
  const tmpDir = mkdtempSync(path.join(tmpdir(), 'vfs-tar-'))

  try {
    // Write tar buffer to temp file
    const tarPath = path.join(tmpDir, 'archive.tar')
    writeFileSync(tarPath, tarBuffer)

    // Create extraction directory
    const _extractDir = path.join(tmpDir, 'extract')

    // Extract using native tar
    const result = spawnSync('tar', ['xf', tarPath, '-C', tmpDir], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    if (result.error) {
      throw new Error(`Failed to spawn tar: ${result.error.message}`)
    }

    if (result.status !== 0) {
      throw new Error(`tar extraction failed: ${result.stderr}`)
    }

    // Read all extracted files into Map
    const files = new Map()

    function walkDirectory(dir, prefix = '') {
      const entries = readdirSync(dir, { withFileTypes: true })

      for (const entry of entries) {
        // Skip our temp tar file
        if (entry.name === 'archive.tar') {
          continue
        }

        const fullPath = path.join(dir, entry.name)
        const vfsPath = prefix ? `${prefix}/${entry.name}` : entry.name

        if (entry.isDirectory()) {
          // Store directory entry (null = directory marker)
          files.set(`${vfsPath}/`, null)
          // Recurse into directory
          walkDirectory(fullPath, vfsPath)
        } else if (entry.isFile()) {
          // Read file content
          const content = readFileSync(fullPath)
          files.set(vfsPath, content)
        } else if (entry.isSymbolicLink()) {
          // Store symlink target
          const fs = require('node:fs')
          const target = fs.readlinkSync(fullPath)
          files.set(vfsPath, Buffer.from(target, 'utf8'))
        }
      }
    }

    walkDirectory(tmpDir, '')

    return files
  } finally {
    // Clean up temp directory
    try {
      rmSync(tmpDir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Parse TAR archive with fallback to pure JS parser
 *
 * @param {Buffer} tarBuffer - TAR archive data
 * @returns {Map<string, Buffer>} Map of filename to file content
 */
function parseTarWithFallback(tarBuffer) {
  // Try native tar first
  try {
    return parseTar(tarBuffer)
  } catch (err) {
    // Fall back to pure JS parser
    if (process.env.NODE_DEBUG_VFS) {
      process._rawDebug(
        `VFS: Native tar failed (${err.message}), using JS parser`,
      )
    }

    const {
      parseTar: parseTarJS,
    } = require('internal/socketsecurity_vfs/tar_parser')
    return parseTarJS(tarBuffer)
  }
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
  const _depth = normalizedDir === '' ? 0 : normalizedDir.split('/').length - 1

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
    return vfsMap.has(normalized) && vfsMap.get(normalized) === null
  }

  // Check if path with trailing slash exists
  const withSlash = `${normalized}/`
  if (vfsMap.has(withSlash) && vfsMap.get(withSlash) === null) {
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

module.exports = {
  parseTar: parseTarWithFallback,
  getDirectoryListing,
  isDirectory,
  hasNativeTar,
}
