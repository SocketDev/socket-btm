'use strict'

// Documentation: docs/additions/lib/internal/socketsecurity/vfs/sea_path.js.md

// Use primordials for protection against prototype pollution
const {
  ArrayPrototypeMap,
  ArrayPrototypePush,
  Error: ErrorConstructor,
  ObjectFreeze,
  SafeSet,
  SetPrototypeAdd,
  SetPrototypeForEach,
  SetPrototypeHas,
  StringPrototypeIndexOf,
  StringPrototypeReplace,
  StringPrototypeSlice,
  StringPrototypeSplit,
  StringPrototypeStartsWith,
} = primordials

const {
  BufferFrom,
  TRAILING_SLASHES_REGEX,
  createStatObject,
  normalizePath,
} = require('internal/socketsecurity/safe-references')
const { createDebug } = require('internal/socketsecurity/smol/debug')

const debug = createDebug('smol:sea')

// SEA path prefix (matches Node.js VFS proposal)
const SEA_PREFIX = '/sea'

// Cached SEA module and availability
let seaModule
let seaAvailable
// Cached SEA asset keys as SafeSet for O(1) lookup (instead of O(n) array scan)
let seaKeySet

/**
 * Check if SEA module is available and we're running as a SEA
 * @returns {boolean}
 */
function isSeaAvailable() {
  if (seaAvailable !== undefined) {
    return seaAvailable
  }

  try {
    // Lazy-load node:sea module (experimental but required for SEA asset access)
    // eslint-disable-next-line n/no-unsupported-features/node-builtins
    seaModule = require('node:sea')
    seaAvailable = seaModule.isSea()
    if (seaAvailable) {
      debug('SEA mode detected, /sea path enabled')
    }
  } catch {
    // node:sea not available or not running as SEA
    seaAvailable = false
  }

  return seaAvailable
}

/**
 * Check if a path is a SEA asset path (/sea/...)
 * @param {string} filepath - Path to check
 * @returns {boolean}
 */
function isSeaPath(filepath) {
  if (!filepath || typeof filepath !== 'string') {
    return false
  }

  const normalized = normalizePath(filepath)

  // Match /sea or /sea/...
  return (
    normalized === SEA_PREFIX ||
    normalized === `${SEA_PREFIX}/` ||
    StringPrototypeStartsWith(normalized, `${SEA_PREFIX}/`)
  )
}

/**
 * Extract asset key from SEA path
 *
 * @param {string} filepath - Full path (e.g., '/sea/config.json')
 * @returns {string | undefined} Asset key (e.g., 'config.json'), empty string for root, undefined if invalid
 */
function getSeaAssetKey(filepath) {
  const normalized = normalizePath(filepath)

  // Remove trailing slashes
  const cleanPath = StringPrototypeReplace(
    normalized,
    TRAILING_SLASHES_REGEX,
    '',
  )

  // Root /sea path
  if (cleanPath === SEA_PREFIX) {
    return ''
  }

  // Extract key: /sea/foo/bar.json → foo/bar.json
  if (!StringPrototypeStartsWith(cleanPath, `${SEA_PREFIX}/`)) {
    return undefined
  }

  const key = StringPrototypeSlice(cleanPath, SEA_PREFIX.length + 1)

  // Security: reject path traversal. Only check whole segments so that
  // legitimate names containing `..` (e.g. `legacy..config.json`,
  // `v1..v2-migration.txt`, `foo..ext`) aren't false-positived. The
  // attack shape is `..` as its own segment, not `..` as a substring.
  const segments = StringPrototypeSplit(key, '/')
  for (let i = 0; i < segments.length; i++) {
    if (segments[i] === '..' || segments[i] === '.') {
      debug(`Rejected path traversal attempt: ${filepath}`)
      return undefined
    }
  }

  // Normalize any ./ in the path
  if (StringPrototypeStartsWith(key, './')) {
    return StringPrototypeSlice(key, 2)
  }

  return key
}

/**
 * Create ENOENT error for SEA path
 * @param {string} filepath - Original path
 * @param {string} syscall - System call name
 * @returns {Error}
 */
function createSeaENOENT(filepath, syscall = 'open') {
  const error = new ErrorConstructor(
    `ENOENT: no such file or directory, ${syscall} '${filepath}'`,
  )
  error.code = 'ENOENT'
  error.errno = -2
  error.syscall = syscall
  error.path = filepath
  return error
}

/**
 * Create EISDIR error for SEA path
 * @param {string} filepath - Original path
 * @returns {Error}
 */
function createSeaEISDIR(filepath) {
  const error = new ErrorConstructor(
    `EISDIR: illegal operation on a directory, read '${filepath}'`,
  )
  error.code = 'EISDIR'
  error.errno = -21
  error.syscall = 'read'
  error.path = filepath
  return error
}

/**
 * Create ENOTDIR error for SEA path
 * @param {string} filepath - Original path
 * @returns {Error}
 */
function createSeaENOTDIR(filepath) {
  const error = new ErrorConstructor(
    `ENOTDIR: not a directory, scandir '${filepath}'\n` +
      'Hint: SEA assets are flat - use fs.readdirSync("/sea") to list all assets',
  )
  error.code = 'ENOTDIR'
  error.errno = -20
  error.syscall = 'scandir'
  error.path = filepath
  return error
}

/**
 * Read file from SEA assets
 * @param {string} filepath - SEA path (e.g., '/sea/config.json')
 * @param {object} [options] - fs.readFileSync options
 * @returns {Buffer|string|undefined} File content or undefined if not SEA path
 */
function readFileFromSea(filepath, options) {
  if (!isSeaPath(filepath) || !isSeaAvailable()) {
    return
  }

  const key = getSeaAssetKey(filepath)
  if (key === undefined) {
    throw createSeaENOENT(filepath, 'open')
  }

  // Root /sea is a directory
  if (key === '') {
    throw createSeaEISDIR(filepath)
  }

  // Defensive null check for seaModule
  if (!seaModule) {
    throw createSeaENOENT(filepath, 'open')
  }

  try {
    // Get asset as ArrayBuffer or string
    const encoding = options?.encoding
    const asset = seaModule.getAsset(key, encoding)

    // If no encoding specified, convert ArrayBuffer to Buffer
    if (encoding === undefined || encoding === 'buffer') {
      return BufferFrom(asset)
    }

    return asset
  } catch (error) {
    // Convert SEA error to ENOENT
    if (error.code === 'ERR_SINGLE_EXECUTABLE_APPLICATION_ASSET_NOT_FOUND') {
      throw createSeaENOENT(filepath, 'open')
    }
    throw error
  }
}

/**
 * Check if asset exists in SEA
 * @param {string} filepath - SEA path
 * @returns {boolean|undefined} True/false if SEA path, undefined otherwise
 */
function existsInSea(filepath) {
  if (!isSeaPath(filepath) || !isSeaAvailable()) {
    return
  }

  const key = getSeaAssetKey(filepath)
  if (key === undefined) {
    return false
  }

  // Root /sea always "exists"
  if (key === '') {
    return true
  }

  // Check if asset key exists using cached SafeSet for O(1) lookup
  // (defensive null check for seaModule)
  if (!seaModule) {
    return false
  }

  // Build seaKeySet cache on first use (lazy initialization)
  if (seaKeySet === undefined) {
    const keys = seaModule.getAssetKeys()
    seaKeySet = new SafeSet()
    for (let i = 0, { length } = keys; i < length; i += 1) {
      SetPrototypeAdd(seaKeySet, keys[i])
    }
  }

  return SetPrototypeHas(seaKeySet, key)
}

/**
 * Get stat for SEA asset
 * @param {string} filepath - SEA path
 * @returns {object|undefined} Stat object or undefined if not SEA path
 */
function statFromSea(filepath) {
  if (!isSeaPath(filepath) || !isSeaAvailable()) {
    return
  }

  const key = getSeaAssetKey(filepath)
  if (key === undefined) {
    throw createSeaENOENT(filepath, 'stat')
  }

  // Root /sea is a directory
  if (key === '') {
    return createStatObject(true, 0, 0o755)
  }

  // Check if asset exists
  if (!existsInSea(filepath)) {
    throw createSeaENOENT(filepath, 'stat')
  }

  // Get asset to determine size (defensive null check for seaModule)
  if (!seaModule) {
    throw createSeaENOENT(filepath, 'stat')
  }
  try {
    const asset = seaModule.getRawAsset(key)
    return createStatObject(false, asset.byteLength, 0o644)
  } catch {
    throw createSeaENOENT(filepath, 'stat')
  }
}

/**
 * Read directory from SEA assets
 * Only works for /sea root - SEA assets are flat
 * @param {string} filepath - SEA path
 * @param {object} [options] - fs.readdirSync options
 * @returns {string[]|undefined} Asset keys or undefined if not SEA path
 */
function readdirFromSea(filepath, options) {
  if (!isSeaPath(filepath) || !isSeaAvailable()) {
    return
  }

  const key = getSeaAssetKey(filepath)
  if (key === undefined) {
    throw createSeaENOENT(filepath, 'scandir')
  }

  // Only root /sea can be listed
  // For hierarchical listing (e.g., /sea/data), we'd need to parse keys
  if (key !== '') {
    // Check if this looks like a virtual directory
    // by finding keys that start with this prefix
    const prefix = `${key}/`
    // Defensive null check for seaModule
    if (!seaModule) {
      throw createSeaENOTDIR(filepath)
    }
    const keys = seaModule.getAssetKeys()
    const children = new SafeSet()
    // Collect both children and directories in a single pass (O(n) instead of O(2n)).
    const dirSet = options?.withFileTypes ? new SafeSet() : undefined

    for (let i = 0, keysLen = keys.length; i < keysLen; i++) {
      const assetKey = keys[i]
      if (StringPrototypeStartsWith(assetKey, prefix)) {
        // Extract immediate child name
        const rest = StringPrototypeSlice(assetKey, prefix.length)
        const slashIndex = StringPrototypeIndexOf(rest, '/')
        const childName =
          slashIndex === -1 ? rest : StringPrototypeSlice(rest, 0, slashIndex)
        if (childName) {
          SetPrototypeAdd(children, childName)
          // If withFileTypes and there's a slash, this child is a directory.
          if (dirSet && slashIndex !== -1) {
            SetPrototypeAdd(dirSet, childName)
          }
        }
      }
    }

    if (children.size === 0) {
      // No children found - not a directory
      throw createSeaENOTDIR(filepath)
    }

    // Return unique child names
    const entries = []
    SetPrototypeForEach(children, name => {
      ArrayPrototypePush(entries, name)
    })

    if (dirSet) {
      return ArrayPrototypeMap(entries, name => {
        const isDir = SetPrototypeHas(dirSet, name)
        return {
          __proto__: null,
          isBlockDevice: () => false,
          isCharacterDevice: () => false,
          isDirectory: () => isDir,
          isFIFO: () => false,
          isFile: () => !isDir,
          isSocket: () => false,
          isSymbolicLink: () => false,
          name,
        }
      })
    }

    return entries
  }

  // Root /sea - list all asset keys (defensive null check for seaModule)
  if (!seaModule) {
    return []
  }
  const keys = seaModule.getAssetKeys()

  if (options?.withFileTypes) {
    return ArrayPrototypeMap(keys, name => ({
      __proto__: null,
      isBlockDevice: () => false,
      isCharacterDevice: () => false,
      isDirectory: () => false,
      isFIFO: () => false,
      isFile: () => true,
      isSocket: () => false,
      isSymbolicLink: () => false,
      name,
    }))
  }

  return keys
}

module.exports = ObjectFreeze({
  __proto__: null,
  SEA_PREFIX,
  existsInSea,
  getSeaAssetKey,
  isSeaAvailable,
  isSeaPath,
  readFileFromSea,
  readdirFromSea,
  statFromSea,
})
