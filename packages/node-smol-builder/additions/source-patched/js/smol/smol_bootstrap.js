'use strict'

/**
 * Socket Security: node-smol SEA Bootstrap
 *
 * Sets up process.smol object, process.argv handling, and require.resolve support.
 * Follows yao-pkg patterns for ecosystem compatibility.
 */

const path = require('node:path')

const { mount } = require('internal/socketsecurity_smol/smol_mount')

/**
 * Create full-featured require when VFS is available.
 * Enables require.resolve and normal module loading from VFS.
 * Handles native addons (.node files) by extracting to filesystem.
 */
function createVFSRequire() {
  const { createRequire } = require('node:module')
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
  wrappedRequire.resolve = vfsRequire.resolve
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
  hasVFS,
  setupProcessForSmol,
}
