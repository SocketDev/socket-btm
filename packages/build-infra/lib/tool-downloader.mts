/**
 * Tool Download + Cache Engine
 *
 * Downloads pinned tool versions, verifies checksums, and caches them
 * in the repo-local .cache/external-tools/ directory (gitignored via .cache/).
 *
 * Override: $EXTERNAL_TOOLS_CACHE
 */

import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, existsSync, readFileSync } from 'node:fs'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { WIN32 } from '@socketsecurity/lib/constants/platform'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

const logger = getDefaultLogger()

/**
 * Get the repo-local cache directory for downloaded tools.
 * @returns {string}
 */
export function getCacheDir() {
  if (process.env.EXTERNAL_TOOLS_CACHE) {
    return process.env.EXTERNAL_TOOLS_CACHE
  }
  return path.join(process.cwd(), '.cache', 'external-tools')
}

/**
 * Get the cache path for a specific tool version + platform.
 * @param {string} tool - Tool name (e.g., "zig")
 * @param {string} version - Tool version (e.g., "0.15.2")
 * @param {string} platform - Node.js process.platform
 * @param {string} arch - Node.js process.arch
 * @returns {string}
 */
export function getToolCachePath(tool, version, platform, arch) {
  const archMap = { arm64: 'aarch64', x64: 'x86_64' }
  const osMap = { darwin: 'macos', linux: 'linux', win32: 'windows' }
  const target = `${archMap[arch] || arch}-${osMap[platform] || platform}`
  return path.join(getCacheDir(), tool, `${version}-${target}`)
}

/**
 * Compute SHA256 of a file.
 * @param {string} filePath
 * @returns {Promise<string>} Hex-encoded SHA256
 */
export function computeSha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(filePath)
    stream.on('data', data => hash.update(data))
    stream.on('end', () => {
      stream.destroy()
      resolve(hash.digest('hex'))
    })
    stream.on('error', err => {
      stream.destroy()
      reject(err)
    })
  })
}

/**
 * Verify the integrity of a cached tool by checking the stored checksum.
 * @param {string} cachePath - Path to the tool's cache directory
 * @param {string} expectedSha256 - Expected SHA256 of the original archive
 * @returns {boolean}
 */
export function verifyCacheIntegrity(cachePath, expectedSha256) {
  const checksumFile = path.join(cachePath, '.checksum')
  if (!existsSync(checksumFile)) {
    return false
  }
  try {
    const stored = readFileSync(checksumFile, 'utf8').trim()
    return stored === expectedSha256
  } catch {
    return false
  }
}

/**
 * Download a file using curl.
 * @param {string} url - URL to download
 * @param {string} destPath - Destination file path
 * @returns {Promise<void>}
 */
async function downloadFile(url, destPath) {
  await fs.mkdir(path.dirname(destPath), { recursive: true })

  const result = await spawn(
    'curl',
    ['-fSL', '--retry', '3', '-o', destPath, url],
    {
      stdio: 'inherit',
      shell: WIN32,
    },
  )

  if (result.signal) {
    throw new Error(`Download killed by signal ${result.signal}: ${url}`)
  }
  const exitCode = result.code ?? result.exitCode ?? 0
  if (exitCode !== 0) {
    throw new Error(`Download failed (exit ${exitCode}): ${url}`)
  }
}

/**
 * Extract an archive to a directory.
 * @param {string} archivePath - Path to archive
 * @param {string} destDir - Destination directory
 * @param {string} format - Archive format: "tar.xz" or "zip"
 * @returns {Promise<void>}
 */
async function extractArchive(archivePath, destDir, format) {
  await fs.mkdir(destDir, { recursive: true })

  if (format === 'zip') {
    const result = await spawn(
      WIN32 ? 'powershell' : 'unzip',
      WIN32
        ? [
            '-Command',
            `Expand-Archive -Path '${archivePath.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force`,
          ]
        : ['-q', '-o', archivePath, '-d', destDir],
      { stdio: 'inherit', shell: WIN32 },
    )
    if (result.signal) {
      throw new Error(
        `Zip extraction killed by signal ${result.signal} for ${archivePath}`,
      )
    }
    if ((result.code ?? result.exitCode ?? 0) !== 0) {
      throw new Error(`Zip extraction failed for ${archivePath}`)
    }
  } else {
    // tar.xz
    const result = await spawn('tar', ['xf', archivePath, '-C', destDir], {
      stdio: 'inherit',
      shell: WIN32,
    })
    if (result.signal) {
      throw new Error(
        `Tar extraction killed by signal ${result.signal} for ${archivePath}`,
      )
    }
    if ((result.code ?? result.exitCode ?? 0) !== 0) {
      throw new Error(`Tar extraction failed for ${archivePath}`)
    }
  }
}

/**
 * Acquire a simple file-based lock to prevent concurrent downloads.
 * Returns a release function.
 * @param {string} lockPath - Path to lock file
 * @param {number} [timeoutMs=120_000] - Maximum wait time
 * @returns {Promise<() => Promise<void>>} Release function
 */
async function acquireLock(lockPath, timeoutMs = 120_000) {
  await fs.mkdir(path.dirname(lockPath), { recursive: true })

  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      // O_CREAT | O_EXCL — fails if file exists
      const fd = await fs.open(lockPath, 'wx')
      try {
        await fd.writeFile(String(process.pid))
      } finally {
        await fd.close()
      }
      return async () => {
        await fs.unlink(lockPath).catch(() => {})
      }
    } catch (err) {
      if (err.code === 'EEXIST') {
        // Check if lock holder is still alive
        try {
          const pid = parseInt(readFileSync(lockPath, 'utf8').trim(), 10)
          if (pid && !isProcessAlive(pid)) {
            // Stale lock — remove and retry
            await fs.unlink(lockPath).catch(() => {})
            continue
          }
        } catch {
          // Can't read lock — wait
        }
        await new Promise(r => setTimeout(r, 500))
        continue
      }
      throw err
    }
  }
  throw new Error(`Timed out waiting for lock: ${lockPath}`)
}

/**
 * Check if a process is still alive.
 * @param {number} pid
 * @returns {boolean}
 */
function isProcessAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * Download a pinned tool, verify checksum, and cache it.
 *
 * @param {string} tool - Tool name (e.g., "zig")
 * @param {object} resolverResult - From resolver.resolve()
 * @param {string} resolverResult.url - Download URL
 * @param {string} resolverResult.sha256 - Expected SHA256
 * @param {string} resolverResult.extractDir - Directory name inside archive
 * @param {string} resolverResult.binary - Binary filename
 * @param {string} resolverResult.archiveFormat - "tar.xz" or "zip"
 * @param {string} version - Tool version
 * @param {string} platform - Node.js process.platform
 * @param {string} arch - Node.js process.arch
 * @returns {Promise<string>} Path to the tool binary
 */
export async function downloadAndCache(
  tool,
  resolverResult,
  version,
  platform,
  arch,
) {
  const cachePath = getToolCachePath(tool, version, platform, arch)
  const binaryPath = path.join(cachePath, resolverResult.binary)
  const lockPath = path.join(getCacheDir(), `.lock-${tool}-${version}`)

  // Check cache first (with integrity verification)
  if (
    existsSync(binaryPath) &&
    verifyCacheIntegrity(cachePath, resolverResult.sha256)
  ) {
    logger.substep(`Using cached ${tool} ${version}`)
    return binaryPath
  }

  // Acquire lock to prevent concurrent downloads
  logger.substep(`Acquiring download lock for ${tool} ${version}...`)
  const releaseLock = await acquireLock(lockPath)

  try {
    // Re-check cache after acquiring lock (another process may have completed)
    if (
      existsSync(binaryPath) &&
      verifyCacheIntegrity(cachePath, resolverResult.sha256)
    ) {
      logger.substep(
        `Using cached ${tool} ${version} (populated by another process)`,
      )
      return binaryPath
    }

    // Clean any partial/corrupted cache
    if (existsSync(cachePath)) {
      await fs.rm(cachePath, { recursive: true, force: true })
    }

    // Download to temp directory. UUID suffix prevents collision when two
    // async callers in the same process race past the lock (e.g. retry).
    const tmpDir = path.join(
      getCacheDir(),
      `.tmp-${tool}-${version}-${process.pid}-${randomUUID()}`,
    )
    await fs.mkdir(tmpDir, { recursive: true })

    const archiveFilename = path.basename(resolverResult.url)
    const archivePath = path.join(tmpDir, archiveFilename)

    try {
      logger.substep(
        `Downloading ${tool} ${version} (${formatSize(resolverResult.size)})...`,
      )
      await downloadFile(resolverResult.url, archivePath)

      // Verify checksum
      logger.substep('Verifying checksum...')
      const actualSha256 = await computeSha256(archivePath)
      if (actualSha256 !== resolverResult.sha256) {
        throw new Error(
          `Checksum mismatch for ${tool} ${version}:\n` +
            `  Expected: ${resolverResult.sha256}\n` +
            `  Actual:   ${actualSha256}`,
        )
      }
      logger.substep('Checksum verified')

      // Extract
      logger.substep('Extracting...')
      await extractArchive(archivePath, tmpDir, resolverResult.archiveFormat)

      // Move extracted directory to cache (atomic rename)
      const normalizedExtractDir = path.normalize(resolverResult.extractDir)
      if (
        normalizedExtractDir.startsWith('..') ||
        path.isAbsolute(normalizedExtractDir)
      ) {
        throw new Error(
          `Invalid extractDir (path traversal): ${resolverResult.extractDir}`,
        )
      }
      const extractedDir = path.join(tmpDir, normalizedExtractDir)
      if (!existsSync(extractedDir)) {
        throw new Error(
          `Expected extraction directory not found: ${extractedDir}`,
        )
      }

      // Write checksum marker before moving
      await fs.writeFile(
        path.join(extractedDir, '.checksum'),
        resolverResult.sha256,
      )

      // Atomic rename to final cache location
      await fs.mkdir(path.dirname(cachePath), { recursive: true })
      await fs.rename(extractedDir, cachePath)

      // Clean up temp directory
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})

      // Verify binary exists
      if (!existsSync(binaryPath)) {
        throw new Error(`Binary not found after extraction: ${binaryPath}`)
      }

      logger.success(`${tool} ${version} installed to ${cachePath}`)
      return binaryPath
    } catch (err) {
      // Clean up on failure
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
      throw err
    }
  } finally {
    await releaseLock()
  }
}

/**
 * Get a cached tool binary path, or undefined if not cached/invalid.
 * @param {string} tool - Tool name
 * @param {string} version - Tool version
 * @param {string} platform - Node.js process.platform
 * @param {string} arch - Node.js process.arch
 * @param {string} binary - Binary filename
 * @param {string} expectedSha256 - Expected checksum
 * @returns {string|undefined} Path to binary if valid cache exists
 */
export function getCachedToolBinary(
  tool,
  version,
  platform,
  arch,
  binary,
  expectedSha256,
) {
  const cachePath = getToolCachePath(tool, version, platform, arch)
  const binaryPath = path.join(cachePath, binary)
  if (
    existsSync(binaryPath) &&
    verifyCacheIntegrity(cachePath, expectedSha256)
  ) {
    return binaryPath
  }
  return undefined
}

/**
 * Format byte size for display.
 * @param {number} [bytes]
 * @returns {string}
 */
function formatSize(bytes) {
  if (!bytes) {
    return 'unknown size'
  }
  if (bytes < 1024) {
    return `${bytes} B`
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(0)} KB`
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
