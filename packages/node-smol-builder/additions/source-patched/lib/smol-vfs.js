'use strict'

// Documentation: docs/additions/lib/smol-vfs.js.md

const { ObjectDefineProperty, ObjectFreeze } = primordials

// Lazy-loaded SQL providers to avoid startup cost.
let _SmolSqliteProvider
let _SmolPgProvider

function getSmolSqliteProvider() {
  if (!_SmolSqliteProvider) {
    _SmolSqliteProvider =
      require('internal/socketsecurity/vfs/sqlite_provider').SmolSqliteProvider
  }
  return _SmolSqliteProvider
}

function getSmolPgProvider() {
  if (!_SmolPgProvider) {
    _SmolPgProvider =
      require('internal/socketsecurity/vfs/pg_provider').SmolPgProvider
  }
  return _SmolPgProvider
}

const {
  // Core state
  hasVFS,
  config,
  prefix,
  size,
  canBuildSea,

  // Sync file operations (fs-compatible)
  existsSync,
  readFileSync,
  statSync,
  lstatSync,
  readdirSync,
  accessSync,
  realpathSync,
  readlinkSync,

  // File descriptor operations (uses real FDs via extraction)
  openSync,
  closeSync,
  readSync,
  fstatSync,
  isVfsFd,
  getVfsPath,
  getRealPath,

  // Async operations (fs/promises compatible)
  promises,

  // Streams
  createReadStream,

  // VFS-specific operations
  listFiles,
  mount,
  mountSync,

  // Native addon support
  handleNativeAddon,
  isNativeAddon,

  // Error class
  VFSError,

  // Constants
  MODE_COMPAT,
  MODE_IN_MEMORY,
  MODE_ON_DISK,

  // Convenience/Debug
  getCacheStats,
} = require('internal/socketsecurity/vfs/fs')

// Default export object with lazy SQL providers
const defaultExport = {
  __proto__: null,
  hasVFS,
  config,
  prefix,
  size,
  canBuildSea,
  existsSync,
  readFileSync,
  statSync,
  lstatSync,
  readdirSync,
  accessSync,
  realpathSync,
  readlinkSync,
  openSync,
  closeSync,
  readSync,
  fstatSync,
  isVfsFd,
  getVfsPath,
  getRealPath,
  promises,
  createReadStream,
  listFiles,
  mount,
  mountSync,
  handleNativeAddon,
  isNativeAddon,
  VFSError,
  MODE_COMPAT,
  MODE_IN_MEMORY,
  MODE_ON_DISK,
  getCacheStats,
}

// Lazy-load SQL storage providers to avoid pulling in SQL infrastructure at startup.
ObjectDefineProperty(defaultExport, 'SmolSqliteProvider', {
  __proto__: null,
  configurable: true,
  enumerable: true,
  get: getSmolSqliteProvider,
})

ObjectDefineProperty(defaultExport, 'SmolPgProvider', {
  __proto__: null,
  configurable: true,
  enumerable: true,
  get: getSmolPgProvider,
})

// Main exports object
const vfsExports = {
  __proto__: null,
  // Core state
  hasVFS,
  config,
  prefix,
  size,
  canBuildSea,

  // Sync file operations (fs-compatible subset)
  existsSync,
  readFileSync,
  statSync,
  lstatSync,
  readdirSync,
  accessSync,
  realpathSync,
  readlinkSync,

  // File descriptor operations (real FDs via extraction)
  openSync,
  closeSync,
  readSync,
  fstatSync,
  isVfsFd,
  getVfsPath,
  getRealPath,

  // Async operations (fs/promises compatible)
  promises,

  // Streams
  createReadStream,

  // VFS-specific operations
  listFiles,
  mount,
  mountSync,

  // Native addon support
  handleNativeAddon,
  isNativeAddon,

  // Error class
  VFSError,

  // Constants
  MODE_COMPAT,
  MODE_IN_MEMORY,
  MODE_ON_DISK,

  // Convenience/Debug
  getCacheStats,

  // Default export
  default: ObjectFreeze(defaultExport),
}

// Lazy-load SQL storage providers on main exports too.
ObjectDefineProperty(vfsExports, 'SmolSqliteProvider', {
  __proto__: null,
  configurable: true,
  enumerable: true,
  get: getSmolSqliteProvider,
})

ObjectDefineProperty(vfsExports, 'SmolPgProvider', {
  __proto__: null,
  configurable: true,
  enumerable: true,
  get: getSmolPgProvider,
})

module.exports = ObjectFreeze(vfsExports)
