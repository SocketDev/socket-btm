'use strict'

/**
 * Socket Security: node-smol Mount and Native Addon Support
 *
 * Handles extracting files from VFS to real filesystem.
 * Critical for native addons (.node files) and user file extraction.
 */

const fs = require('node:fs')
const path = require('node:path')

const {
  existsInVFS,
  readFileFromVFS,
} = require('internal/socketsecurity_vfs/loader')

// Cache directory for extracted files.
let _cacheNodeModulesDir

/**
 * Get or create cache directory for extracted files.
 */
function getCacheDir() {
  if (_cacheNodeModulesDir) {
    return _cacheNodeModulesDir
  }

  // Extract to node_modules/ next to the binary.
  _cacheNodeModulesDir = path.join(
    path.dirname(process.execPath),
    'node_modules',
  )

  // Create directory if it doesn't exist.
  try {
    fs.mkdirSync(_cacheNodeModulesDir, { recursive: true })
  } catch (e) {
    if (e.code !== 'EEXIST') {
      throw e
    }
  }

  return _cacheNodeModulesDir
}

/**
 * Handle native addon require.
 * Extracts .node file to filesystem and returns real path.
 */
function handleNativeAddon(vfsPath) {
  if (!existsInVFS(vfsPath)) {
    return null
  }

  // Extract to cache.
  const realPath = mount(vfsPath)

  return realPath
}

/**
 * Check if a module path is a native addon.
 */
function isNativeAddon(modulePath) {
  return modulePath.endsWith('.node')
}

/**
 * Mount (extract) a file from VFS to real filesystem.
 * Returns the path to the extracted file.
 *
 * @param {string} vfsPath - Path in VFS (e.g., '/snapshot/node_modules/foo/bar.node')
 * @param {object} options - Options
 * @param {string} options.targetPath - Optional target path (defaults to cache dir)
 * @returns {string} Path to extracted file on real filesystem
 */
function mount(vfsPath, options = {}) {
  if (!existsInVFS(vfsPath)) {
    throw new Error(`File not found in VFS: ${vfsPath}`)
  }

  // Determine target path.
  let targetPath
  if (options.targetPath) {
    targetPath = options.targetPath
  } else {
    // Default: extract to cache dir preserving relative structure.
    // Strip /snapshot/node_modules/ from VFS path since cache dir is already node_modules/.
    const vfsBase = '/snapshot/node_modules'

    // Validate that vfsPath is within expected VFS root (defense in depth).
    if (!vfsPath.startsWith(`${vfsBase}/`)) {
      throw new Error(
        `Invalid VFS path: ${vfsPath} (expected path under ${vfsBase}/)`,
      )
    }

    const relativePath = path.relative(vfsBase, vfsPath)

    // Additional safety check: ensure no directory traversal.
    if (relativePath.startsWith('..')) {
      throw new Error(
        `VFS path '${vfsPath}' resolves outside expected root (got: '${relativePath}')`,
      )
    }

    targetPath = path.join(getCacheDir(), relativePath)
  }

  // Check if already extracted and up-to-date.
  if (fs.existsSync(targetPath)) {
    // TODO: Could check file hash/mtime to see if re-extraction needed.
    return targetPath
  }

  // Read file from VFS.
  const content = readFileFromVFS(vfsPath)
  if (!content) {
    throw new Error(`Failed to read from VFS: ${vfsPath}`)
  }

  // Ensure parent directory exists.
  const dirname = path.dirname(targetPath)
  fs.mkdirSync(dirname, { recursive: true })

  // Write to filesystem.
  fs.writeFileSync(targetPath, content)

  return targetPath
}

module.exports = {
  getCacheDir,
  handleNativeAddon,
  isNativeAddon,
  mount,
}
