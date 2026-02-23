'use strict'

/**
 * Socket Security: VFS Extraction Providers
 *
 * Provides different strategies for extracting files from VFS to filesystem:
 * - on-disk: Persistent cache in ~/.socket/_dlx/
 * - in-memory: Temporary files (for read-only filesystems)
 * - compat: No-op (VFS disabled)
 *
 * IMPORTANT: This file runs during early bootstrap. Use require('fs') not
 * require('node:fs') - the node: protocol isn't available at this stage.
 */

// eslint-disable-next-line n/prefer-node-protocol
const crypto = require('crypto')
// eslint-disable-next-line n/prefer-node-protocol
const fs = require('fs')
// eslint-disable-next-line n/prefer-node-protocol
const os = require('os')
// eslint-disable-next-line n/prefer-node-protocol
const path = require('path')

const VFS_MODE_ON_DISK = 'on-disk'
const VFS_MODE_IN_MEMORY = 'in-memory'
const VFS_MODE_COMPAT = 'compat'

/**
 * On-Disk Extraction Provider
 * Extracts files to persistent cache directory: ~/.socket/_dlx/<hash>/
 */
class OnDiskExtractionProvider {
  constructor() {
    // Cache directory based on executable path
    const exeHash = crypto
      .createHash('sha256')
      .update(process.execPath)
      .digest('hex')
      .slice(0, 16)

    this._cacheDir = path.join(os.homedir(), '.socket', '_dlx', exeHash, 'vfs')
    this._extracted = new Map()
  }

  _getCacheDir() {
    return this._cacheDir
  }

  getExtracted(relativePath) {
    // Check memory cache first
    if (this._extracted.has(relativePath)) {
      const cachedPath = this._extracted.get(relativePath)
      // Re-validate path still exists (TOCTOU protection)
      if (fs.existsSync(cachedPath)) {
        return cachedPath
      }
      // Path was deleted, invalidate cache entry
      this._extracted.delete(relativePath)
    }

    // Check if file exists on disk
    const cachedPath = path.join(this._cacheDir, relativePath)
    if (fs.existsSync(cachedPath)) {
      this._extracted.set(relativePath, cachedPath)
      return cachedPath
    }

    return undefined
  }

  extract(relativePath, content) {
    const targetPath = path.join(this._cacheDir, relativePath)
    const dirname = path.dirname(targetPath)

    // Create directory structure
    fs.mkdirSync(dirname, { recursive: true })

    // Write file
    fs.writeFileSync(targetPath, content)

    // Cache the result
    this._extracted.set(relativePath, targetPath)

    return targetPath
  }
}

/**
 * In-Memory Extraction Provider
 * Extracts files to temporary directory (for read-only filesystems)
 */
class InMemoryExtractionProvider {
  constructor() {
    // Create unique temp directory for this process
    this._tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vfs-'))
    this._extracted = new Map()
  }

  getExtracted(relativePath) {
    const cachedPath = this._extracted.get(relativePath)
    if (cachedPath) {
      // Re-validate path still exists (staleness protection)
      if (fs.existsSync(cachedPath)) {
        return cachedPath
      }
      // Path was deleted, invalidate cache entry
      this._extracted.delete(relativePath)
    }
    return undefined
  }

  extract(relativePath, content) {
    const targetPath = path.join(this._tempDir, relativePath)
    const dirname = path.dirname(targetPath)

    // Create directory structure
    fs.mkdirSync(dirname, { recursive: true })

    // Write file
    fs.writeFileSync(targetPath, content)

    // Cache the result
    this._extracted.set(relativePath, targetPath)

    return targetPath
  }
}

/**
 * Compat Extraction Provider (No-Op)
 * Used when VFS is disabled - should never be called
 */
class CompatExtractionProvider {
  getExtracted() {
    return undefined
  }

  extract(relativePath) {
    throw new Error(
      'VFS Error: Extraction not supported in compat mode\n' +
        `  Attempted to extract: ${relativePath}\n` +
        '  This indicates VFS is disabled or not configured',
    )
  }
}

/**
 * Create extraction provider based on VFS mode
 */
function createExtractionProvider(mode) {
  switch (mode) {
    case VFS_MODE_ON_DISK:
      return new OnDiskExtractionProvider()
    case VFS_MODE_IN_MEMORY:
      return new InMemoryExtractionProvider()
    case VFS_MODE_COMPAT:
      return new CompatExtractionProvider()
    default:
      throw new Error(
        `VFS Error: Unknown extraction mode: ${mode}\n` +
          `  Valid modes: ${VFS_MODE_ON_DISK}, ${VFS_MODE_IN_MEMORY}, ${VFS_MODE_COMPAT}`,
      )
  }
}

module.exports = {
  createExtractionProvider,
  OnDiskExtractionProvider,
  InMemoryExtractionProvider,
  CompatExtractionProvider,
}
