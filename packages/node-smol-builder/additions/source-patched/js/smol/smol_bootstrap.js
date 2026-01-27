'use strict'

/**
 * Socket Security: node-smol SEA Bootstrap
 *
 * Sets up process.smol object, process.argv handling, and require.resolve support.
 * Follows yao-pkg patterns for ecosystem compatibility.
 *
 * IMPORTANT: This file runs during early bootstrap, before the full require()
 * system is initialized. Use require('path') not require('node:path') - the
 * node: protocol isn't available at this stage.
 */

// eslint-disable-next-line n/prefer-node-protocol
const path = require('path')

const { mount } = require('internal/socketsecurity_smol/smol_mount')

/**
 * Enhance a require function with standard properties (resolve, main, extensions, cache).
 * Uses the same approach as traditional Node.js module loading via makeRequireFunction.
 * @param {Function} baseRequire - The base require function to enhance
 * @returns {Function} Enhanced require with standard properties
 */
function enhanceRequire(baseRequire) {
  // Use the standard Node.js module system to create a proper require.
  // This simulates what happens in traditional non-SEA code paths.
  // eslint-disable-next-line n/prefer-node-protocol
  const { Module } = require('module')
  const { makeRequireFunction } = require('internal/modules/helpers')

  // Create a temporary module for the virtual script path to get a proper require.
  // In SEA context, the entry point is the virtual script, not the executable.
  const scriptPath = getVirtualScriptPath()
  const tempModule = new Module(scriptPath, null)
  tempModule.filename = scriptPath
  tempModule.paths = Module._nodeModulePaths(scriptPath)

  // Use makeRequireFunction to create a fully-featured require.
  const fullRequire = makeRequireFunction(tempModule)

  // Copy all standard properties to the base require.
  baseRequire.resolve = fullRequire.resolve
  baseRequire.main = fullRequire.main
  baseRequire.extensions = fullRequire.extensions
  baseRequire.cache = fullRequire.cache

  return baseRequire
}

/**
 * Create full-featured require when VFS is available.
 * Enables require.resolve and normal module loading from VFS.
 * Handles native addons (.node files) by extracting to filesystem.
 */
function createVFSRequire() {
  // eslint-disable-next-line n/prefer-node-protocol
  const { createRequire } = require('module')
  const {
    handleNativeAddon,
    isNativeAddon,
  } = require('internal/socketsecurity_smol/smol_mount')
  const scriptPath = getVirtualScriptPath()
  const vfsRequire = createRequire(scriptPath)

  // Wrap require to handle native addons.
  function wrappedRequire(id) {
    // Check if it's a native addon path.
    if (isNativeAddon(id)) {
      try {
        // Try to resolve in VFS first.
        const resolved = vfsRequire.resolve(id)
        if (resolved.startsWith('/snapshot/')) {
          // It's in VFS, extract it.
          const realPath = handleNativeAddon(resolved)
          if (realPath) {
            // Load from real filesystem.
            return require(realPath)
          }
        }
      } catch {
        // Not in VFS, fall through to normal require.
      }
    }

    // Normal require path.
    return vfsRequire(id)
  }

  // Copy properties from original require.
  if (vfsRequire.resolve) {
    wrappedRequire.resolve = vfsRequire.resolve
    // Explicitly copy resolve.paths if it exists.
    if (vfsRequire.resolve.paths) {
      wrappedRequire.resolve.paths = vfsRequire.resolve.paths
    }
  }
  wrappedRequire.main = vfsRequire.main
  wrappedRequire.extensions = vfsRequire.extensions
  wrappedRequire.cache = vfsRequire.cache

  return wrappedRequire
}

/**
 * Get virtual script path.
 * Uses /snapshot/ prefix like pkg for ecosystem compatibility.
 */
function getVirtualScriptPath() {
  const scriptName = process.env.NODE_SEA_SCRIPT || 'main.js'
  return `/snapshot/${scriptName}`
}

/**
 * Check if VFS is available and non-empty.
 */
function hasVFS() {
  try {
    // eslint-disable-next-line no-undef
    const vfsBinding = internalBinding('smol_vfs')
    if (!vfsBinding || !vfsBinding.hasVFSBlob()) {
      return false
    }

    // Check if VFS is empty (zero-byte blob).
    // Empty VFS means infrastructure exists but no files bundled.
    const blob = vfsBinding.getVFSBlob()
    if (!blob || blob.length === 0) {
      // Empty VFS: infrastructure exists but use normal require.
      return false
    }

    return true
  } catch {
    return false
  }
}

/**
 * Get cache directory respecting environment variable priority.
 * Matches dlx_get_cache_base_dir from C code.
 */
function getCacheDir() {
  // eslint-disable-next-line n/prefer-node-protocol
  const os = require('os')

  // Priority 1: SOCKET_DLX_DIR (full override)
  const dlxDir = process.env.SOCKET_DLX_DIR
  if (dlxDir) {
    return dlxDir
  }

  // Priority 2: SOCKET_HOME (base directory + _dlx)
  const socketHome = process.env.SOCKET_HOME
  if (socketHome) {
    return path.join(socketHome, '_dlx')
  }

  // Priority 3: Default $HOME/.socket/_dlx
  const home = process.env.HOME || os.homedir()
  return path.join(home, '.socket', '_dlx')
}

/**
 * Setup process.argv and process.smol.
 * Handles entry point insertion for SEA binaries with VFS.
 */
function setupProcessForSmol() {
  const EXECPATH = process.execPath
  const DEFAULT_ENTRYPOINT = getVirtualScriptPath()

  // Check user preference for argv behavior
  const fakeArgvEnv = process.env.NODE_SMOL_FAKE_ARGV
  let shouldInsertEntrypoint

  if (fakeArgvEnv === '0' || fakeArgvEnv === 'false') {
    // User explicitly disabled entry point insertion
    shouldInsertEntrypoint = false
  } else if (fakeArgvEnv === '1' || fakeArgvEnv === 'true') {
    // User explicitly enabled entry point insertion
    shouldInsertEntrypoint = true
  } else {
    // Default: insert for SEA (has VFS), don't insert for plain node-smol
    shouldInsertEntrypoint = hasVFS()
  }

  // Replace argv[1] with virtual entry point if needed.
  // Node.js SEA duplicates argv[0] at argv[1] as a placeholder for the script path.
  // We replace that duplicate with the virtual entrypoint (following yao-pkg pattern).
  if (shouldInsertEntrypoint && process.argv[1] !== DEFAULT_ENTRYPOINT) {
    process.argv[1] = DEFAULT_ENTRYPOINT
  }

  const ENTRYPOINT = process.argv[1] || DEFAULT_ENTRYPOINT

  // Set up process.smol object
  if (!process.smol) {
    // Lazy-load VFS loader functions (only loaded if accessed)
    let vfsLoaderCache = null
    function getVFSLoader() {
      if (!vfsLoaderCache) {
        vfsLoaderCache = require('internal/socketsecurity_vfs/loader')
      }
      return vfsLoaderCache
    }

    process.smol = {
      __proto__: null,
      // Path properties
      stubPath: process.env.SOCKET_SMOL_STUB_PATH || EXECPATH,
      execPath: EXECPATH,
      cacheDir: getCacheDir(),
      cacheKey: process.env.NODE_SMOL_CACHE_KEY,
      // Core properties
      entrypoint: ENTRYPOINT,
      defaultEntrypoint: DEFAULT_ENTRYPOINT,
      hasVFS: hasVFS(),
      // Mount function (like yao-pkg)
      mount,
      // Path utilities (like yao-pkg)
      path: {
        __proto__: null,
        resolve(...args) {
          return path.resolve(path.dirname(ENTRYPOINT), ...args)
        },
      },
      // VFS loader functions (lazy-loaded)
      get vfs() {
        return getVFSLoader()
      },
    }

    // Set version info for detection
    if (!process.versions.smol) {
      process.versions.smol = '%SMOL_VERSION%'
    }
  }

  // Clean up ephemeral environment variables
  delete process.env.NODE_SMOL_CACHE_KEY
  delete process.env.NODE_SMOL_FAKE_ARGV
  delete process.env.SOCKET_SMOL_STUB_PATH
  // Keep SOCKET_DLX_DIR and SOCKET_HOME (user config)
}

module.exports = {
  createVFSRequire,
  enhanceRequire,
  hasVFS,
  setupProcessForSmol,
}
