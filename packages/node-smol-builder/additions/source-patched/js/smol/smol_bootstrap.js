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
 * Setup process.argv and process.smol following yao-pkg patterns.
 */
function setupProcessForSmol() {
  const _ARGV0 = process.argv[0]
  const EXECPATH = process.execPath
  const DEFAULT_ENTRYPOINT = getVirtualScriptPath()
  let ENTRYPOINT = process.argv[1]

  // Check for fakeArgv mode (nexe-style).
  // When NODE_SMOL_FAKE_ARGV=1, insert entry point into argv[1].
  const useFakeArgv = process.env.NODE_SMOL_FAKE_ARGV === '1'

  if (useFakeArgv) {
    // Insert fake entry point if missing or if argv[1] is the executable.
    if (!process.argv[1] || process.argv[1] === EXECPATH) {
      process.argv.splice(1, 0, DEFAULT_ENTRYPOINT)
    }
  } else {
    // Follow yao-pkg pattern: remove dummy entrypoint and shift args.
    // Check if we should manipulate argv based on environment.
    if (process.env.NODE_SMOL_EXECPATH === EXECPATH) {
      process.argv.splice(1, 1)
      if (process.argv[1] && process.argv[1] !== '-') {
        process.argv[1] = path.resolve(process.argv[1])
      }
    } else if (process.argv[1] === EXECPATH || !process.argv[1]) {
      // Set argv[1] to default entry point.
      process.argv[1] = DEFAULT_ENTRYPOINT
    }
  }

  // Extract final entrypoint.
  ENTRYPOINT = process.argv[1] || DEFAULT_ENTRYPOINT

  // Clean up environment variables.
  delete process.env.NODE_SMOL_EXECPATH
  delete process.env.NODE_SMOL_FAKE_ARGV

  // Set up process.smol object (following yao-pkg structure).
  if (!process.smol) {
    process.smol = {
      __proto__: null,
      // Core properties (like yao-pkg).
      entrypoint: ENTRYPOINT,
      defaultEntrypoint: DEFAULT_ENTRYPOINT,
      hasVFS: hasVFS(),
      // Mount function (like yao-pkg).
      mount,
      // Path utilities (like yao-pkg).
      path: {
        __proto__: null,
        resolve(...args) {
          return path.resolve(path.dirname(ENTRYPOINT), ...args)
        },
      },
    }

    // Set version info for detection.
    if (!process.versions.smol) {
      process.versions.smol = '%SMOL_VERSION%'
    }
  }
}

module.exports = {
  createVFSRequire,
  enhanceRequire,
  hasVFS,
  setupProcessForSmol,
}
