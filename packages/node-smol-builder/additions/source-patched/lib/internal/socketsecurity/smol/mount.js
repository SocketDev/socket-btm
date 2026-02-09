'use strict'

/**
 * Socket Security: node-smol Mount and Native Addon Support
 *
 * Handles extracting files from VFS to real filesystem.
 * Critical for native addons (.node files) and user file extraction.
 *
 * IMPORTANT: This file runs during early bootstrap. Use require('fs') not
 * require('node:fs') - the node: protocol isn't available at this stage.
 */

// eslint-disable-next-line n/prefer-node-protocol
const path = require('path')

const {
  createExtractionProvider,
} = require('internal/socketsecurity/vfs/extraction_provider')
const {
  VFS_MODE_IN_MEMORY,
  existsInVFS,
  getVFSConfig,
  readFileFromVFS,
} = require('internal/socketsecurity/vfs/loader')

// Extraction provider (lazy-initialized based on VFS config)
let _extractionProvider

/**
 * Get extraction provider (lazy-initialized based on VFS config)
 */
function getExtractionProvider() {
  if (_extractionProvider) {
    return _extractionProvider
  }

  // Get VFS configuration to determine extraction mode
  const vfsConfig = getVFSConfig()
  const mode = vfsConfig?.mode || VFS_MODE_IN_MEMORY

  _extractionProvider = createExtractionProvider(mode)

  return _extractionProvider
}

/**
 * Get cache directory for extracted files.
 * @deprecated Use extraction provider directly
 */
function getCacheDir() {
  const provider = getExtractionProvider()
  // For backward compatibility with on-disk provider
  if (provider._getCacheDir) {
    return provider._getCacheDir()
  }
  return path.join(path.dirname(process.execPath), 'node_modules')
}

/**
 * Handle native addon require.
 * Extracts .node file to filesystem and returns real path.
 */
function handleNativeAddon(vfsPath) {
  if (!existsInVFS(vfsPath)) {
    return
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
 * @param {string} options.targetPath - Optional target path (defaults to provider extraction)
 * @returns {string} Path to extracted file on real filesystem
 */
function mount(vfsPath, options = {}) {
  if (!existsInVFS(vfsPath)) {
    const vfsConfig = getVFSConfig()
    const vfsPrefix = vfsConfig?.prefix || '/snapshot'
    throw new Error(
      `VFS Error: File not found in VFS: ${vfsPath}\n` +
        `  Expected path format: ${vfsPrefix}/node_modules/<package>/<file>\n` +
        '  Hint: Use DEBUG=smol:vfs:verbose to list all available VFS files',
    )
  }

  // Get VFS configuration for path prefix
  const vfsConfig = getVFSConfig()
  const vfsPrefix = vfsConfig?.prefix || '/snapshot'
  const vfsBase = `${vfsPrefix}/node_modules`

  // Validate that vfsPath is within expected VFS root (defense in depth).
  if (!vfsPath.startsWith(`${vfsBase}/`)) {
    throw new Error(
      `VFS Error: Invalid VFS path: ${vfsPath}\n` +
        `  Expected path under: ${vfsBase}/\n` +
        `  Current VFS prefix: ${vfsPrefix} (configure via NODE_VFS_PREFIX)`,
    )
  }

  const relativePath = path.relative(vfsBase, vfsPath)

  // Additional safety check: ensure no directory traversal.
  if (relativePath.startsWith('..')) {
    throw new Error(
      'VFS Error: Path traversal detected\n' +
        `  Attempted path: ${vfsPath}\n` +
        `  Resolved to: ${relativePath}\n` +
        '  This is a security violation - paths must stay within VFS root',
    )
  }

  // Use custom target path if provided (backward compatibility)
  if (options.targetPath) {
    // Custom extraction - read from VFS and write to specified location
    const content = readFileFromVFS(vfsPath)
    if (!content) {
      throw new Error(
        `VFS Error: Failed to read file from VFS: ${vfsPath}\n` +
          '  File exists in VFS but could not be read\n' +
          '  This may indicate VFS corruption',
      )
    }

    // eslint-disable-next-line n/prefer-node-protocol
    const fs = require('fs')
    const dirname = path.dirname(options.targetPath)
    try {
      fs.mkdirSync(dirname, { recursive: true })
      fs.writeFileSync(options.targetPath, content)
    } catch (err) {
      throw new Error(
        'VFS Error: Failed to extract file to custom path\n' +
          `  VFS path: ${vfsPath}\n` +
          `  Target path: ${options.targetPath}\n` +
          `  Error: ${err.message}`,
      )
    }

    return options.targetPath
  }

  // Use extraction provider (default behavior)
  const provider = getExtractionProvider()

  // Check if already extracted
  const existing = provider.getExtracted(relativePath)
  if (existing) {
    return existing
  }

  // Read file from VFS
  const content = readFileFromVFS(vfsPath)
  if (!content) {
    throw new Error(
      `VFS Error: Failed to read file from VFS: ${vfsPath}\n` +
        '  File exists in VFS but could not be read\n' +
        '  This may indicate VFS corruption',
    )
  }

  // Extract using provider
  let extractedPath
  try {
    extractedPath = provider.extract(relativePath, content)
  } catch (err) {
    const mode = vfsConfig?.mode || VFS_MODE_IN_MEMORY
    throw new Error(
      'VFS Error: Failed to extract file\n' +
        `  VFS path: ${vfsPath}\n` +
        `  Extraction mode: ${mode}\n` +
        `  Error: ${err.message}\n` +
        '  Hint: Try NODE_VFS_MODE=in-memory if filesystem is read-only',
    )
  }

  return extractedPath
}

module.exports = {
  getCacheDir,
  handleNativeAddon,
  isNativeAddon,
  mount,
}
