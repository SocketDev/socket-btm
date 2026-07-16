/**
 * VFS External Tools Downloader.
 *
 * Downloads pre-built security tools (Python, Trivy, TruffleHog, OpenGrep)
 * for bundling into VFS archives across all platforms.
 *
 * Usage: socket-cli and other consumers can use this to download
 * platform-specific tool binaries for VFS embedding.
 */

import crypto from 'node:crypto'
import { createReadStream, existsSync, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import AdmZip from 'adm-zip'
import process from 'node:process'

import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { httpDownload } from '@socketsecurity/lib-stable/http-request/download'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { errorMessage } from './error-utils.mts'
import {
  getAvailableTools,
  getPlatformKey,
  VFS_TOOL_URLS,
} from './vfs-tool-catalog.mts'

export {
  VFS_TOOL_URLS,
  getAvailableTools,
  getPlatformKey,
} from './vfs-tool-catalog.mts'

const logger = getDefaultLogger()

/**
 * Default download timeout: 5 minutes.
 */
const DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000

/**
 * Maximum retry attempts for transient errors.
 */
const MAX_RETRIES = 3

/**
 * Delay between retries (exponential backoff base)
 */
const RETRY_DELAY_MS = 1000

/**
 * Compute SHA256 hash of a file.
 *
 * @param {string} filePath - Path to file.
 *
 * @returns {Promise<string>} Hex-encoded SHA256 hash
 */
// oxlint-disable-next-line socket/sort-source-methods -- file is ordered by download pipeline phase (parse manifest → fetch → verify checksum → pack); alphabetizing across phases would scatter the download flow.
export async function computeFileSha256(filePath) {
  const hash = crypto.createHash('sha256')
  const stream = createReadStream(filePath)

  return new Promise((resolve, reject) => {
    stream.on('data', chunk => hash.update(chunk))
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
 * Verify file SHA256 hash matches expected value.
 *
 * @param {string} filePath - Path to file.
 * @param {string} expectedHash - Expected SHA256 hash (hex)
 *
 * @returns {Promise<boolean>} True if hash matches
 */
export async function verifyFileSha256(filePath, expectedHash) {
  const actualHash = await computeFileSha256(filePath)
  return actualHash.toLowerCase() === expectedHash.toLowerCase()
}

/**
 * Download a file from URL to destination with timeout and retry.
 *
 * @param {string} url - URL to download.
 * @param {string} destPath - Destination file path.
 * @param {object} [options] - Download options.
 * @param {number} [options.timeout] - Timeout in ms (default: 5 minutes)
 * @param {number} [options.retries] - Max retries (default: 3)
 *
 * @returns {Promise<void>}
 */
// oxlint-disable-next-line socket/sort-source-methods -- file is ordered by download pipeline phase (parse manifest → fetch → verify checksum → pack); alphabetizing across phases would scatter the download flow.
export async function downloadFile(url, destPath, options = {}) {
  const timeout = options.timeout ?? DOWNLOAD_TIMEOUT_MS
  const maxRetries = options.retries ?? MAX_RETRIES

  await httpDownload(url, destPath, {
    headers: {
      'User-Agent': 'socket-btm-vfs-tools-downloader/1.0',
    },
    retries: maxRetries - 1,
    retryDelay: RETRY_DELAY_MS,
    timeout,
  })
}

/**
 * Extract archive (tar.gz or zip) to destination directory.
 * Validates that extraction produced files.
 *
 * @param {string} archivePath - Path to archive file.
 * @param {string} destDir - Destination directory.
 *
 * @returns {Promise<void>}
 */
// oxlint-disable-next-line socket/sort-source-methods -- file is ordered by download pipeline phase (parse manifest → fetch → verify checksum → pack); alphabetizing across phases would scatter the download flow.
export async function extractArchive(archivePath, destDir) {
  await fs.mkdir(destDir, { recursive: true })

  if (archivePath.endsWith('.zip')) {
    // Extract zip archive using adm-zip.
    // adm-zip provides cross-platform zip extraction with zero dependencies
    // and built-in path traversal protection (fixed in v0.4.9, CVE-2018-1002204).
    const zip = new AdmZip(archivePath)
    zip.extractAllTo(destDir, true)
  } else if (archivePath.endsWith('.tar.gz') || archivePath.endsWith('.tgz')) {
    // Use tar command
    const result = await spawn('tar', ['-xzf', archivePath, '-C', destDir], {
      stdio: 'pipe',
    })
    if (result.code !== 0) {
      throw new Error(`tar extraction failed with code ${result.code}`)
    }
  } else {
    throw new Error(`Unsupported archive format: ${archivePath}`)
  }

  // Validate extraction produced files
  const entries = await fs.readdir(destDir)
  if (entries.length === 0) {
    throw new Error(`Extraction produced no files in ${destDir}`)
  }
}

/**
 * Download and extract a VFS tool for the specified platform.
 *
 * @param {string} toolName - Tool name (python, trivy, trufflehog, opengrep)
 * @param {object} options - Options.
 * @param {string} options.destDir - Destination directory.
 * @param {string} [options.platform] - Target platform (defaults to current)
 * @param {string} [options.arch] - Target architecture (defaults to current)
 * @param {boolean} [options.force] - Force re-download even if exists.
 * @param {boolean} [options.skipHashVerification] - Skip SHA256 verification
 *   (NOT RECOMMENDED)
 *
 * @returns {Promise<{ success: boolean; toolDir: string; version: string }>}
 */
// oxlint-disable-next-line socket/sort-source-methods -- file is ordered by download pipeline phase (parse manifest → fetch → verify checksum → pack); alphabetizing across phases would scatter the download flow.
export async function downloadVfsTool(
  toolName,
  {
    arch = process.arch,
    destDir,
    force = false,
    platform = process.platform,
    skipHashVerification = false,
  },
) {
  const toolConfig = VFS_TOOL_URLS[toolName]
  if (!toolConfig) {
    throw new Error(`Unknown VFS tool: ${toolName}`)
  }

  const key = getPlatformKey(platform, arch)
  const assetConfig = toolConfig[key]

  if (!assetConfig) {
    logger.warn(`${toolName} not available for ${key}`)
    return { success: false, toolDir: '', version: toolConfig.version }
  }

  // Handle both old format (string URL) and new format (object with url/sha256)
  const url = typeof assetConfig === 'string' ? assetConfig : assetConfig.url
  const expectedSha256 =
    typeof assetConfig === 'object' ? assetConfig.sha256 : undefined

  const { version } = toolConfig
  const toolDir = path.join(destDir, toolName, key)
  const versionFile = path.join(toolDir, '.version')

  // Check if already downloaded with correct version
  if (!force && existsSync(versionFile)) {
    const existingVersion = await fs.readFile(versionFile, 'utf8')
    if (existingVersion.trim() === version) {
      logger.info(`${toolName} ${version} already downloaded for ${key}`)
      return { success: true, toolDir, version }
    }
  }

  logger.info(`Downloading ${toolName} ${version} for ${key}...`)

  // Create temp directory for download
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), `vfs-${toolName}-`))
  const archiveName = path.basename(new URL(url).pathname)
  const archivePath = path.join(tmpDir, archiveName)

  try {
    // Download archive
    await downloadFile(url, archivePath)

    // Verify SHA256 hash
    if (!skipHashVerification) {
      if (!expectedSha256) {
        throw new Error(
          `No SHA256 hash configured for ${toolName}. ` +
            `Run 'pnpm run update:vfs-tools' to populate hashes.`,
        )
      }
      logger.info(`Verifying SHA256 checksum for ${toolName}...`)
      const hashValid = await verifyFileSha256(archivePath, expectedSha256)
      if (!hashValid) {
        const actualHash = await computeFileSha256(archivePath)
        throw new Error(
          `SHA256 mismatch for ${toolName}!\n` +
            `  Expected: ${expectedSha256}\n` +
            `  Actual:   ${actualHash}\n` +
            '  This could indicate a corrupted download or supply chain attack.',
        )
      }
      logger.success(`SHA256 verified for ${toolName}`)
    }

    // Clean destination and extract
    await safeDelete(toolDir)
    await extractArchive(archivePath, toolDir)

    // Write version marker
    await fs.writeFile(versionFile, version)

    logger.success(`Downloaded ${toolName} ${version} for ${key}`)
    return { success: true, toolDir, version }
  } finally {
    // Cleanup temp directory
    await safeDelete(tmpDir).catch(() => {})
  }
}

/**
 * Download all available VFS tools for a platform.
 *
 * @param {object} options - Options.
 * @param {string} options.destDir - Destination directory.
 * @param {string} [options.platform] - Target platform (defaults to current)
 * @param {string} [options.arch] - Target architecture (defaults to current)
 * @param {string[]} [options.tools] - Specific tools to download (defaults to
 *   all available)
 * @param {boolean} [options.force] - Force re-download even if exists.
 *
 * @returns {Promise<{
 *   success: boolean
 *   downloaded: string[]
 *   failed: string[]
 * }>}
 */
// oxlint-disable-next-line socket/sort-source-methods -- file is ordered by download pipeline phase (parse manifest → fetch → verify checksum → pack); alphabetizing across phases would scatter the download flow.
export async function downloadAllVfsTools({
  arch = process.arch,
  destDir,
  force = false,
  platform = process.platform,
  tools,
}) {
  const availableTools = tools || getAvailableTools(platform, arch)
  const downloaded = []
  const failed = []

  logger.info(`Downloading VFS tools for ${getPlatformKey(platform, arch)}...`)

  // Download tools sequentially to avoid overwhelming the network
  for (let i = 0; i < availableTools.length; i++) {
    const toolName = availableTools[i]
    try {
      // eslint-disable-next-line no-await-in-loop -- Sequential downloads for rate limiting
      const result = await downloadVfsTool(toolName, {
        arch,
        destDir,
        force,
        platform,
      })
      if (result.success) {
        downloaded.push(toolName)
      } else {
        failed.push(toolName)
      }
    } catch (e) {
      logger.error(`Failed to download ${toolName}: ${errorMessage(e)}`)
      failed.push(toolName)
    }
  }

  if (downloaded.length > 0) {
    logger.success(
      `Downloaded ${downloaded.length} tools: ${downloaded.join(', ')}`,
    )
  }
  if (failed.length > 0) {
    logger.warn(
      `Failed to download ${failed.length} tools: ${failed.join(', ')}`,
    )
  }

  return {
    downloaded,
    failed,
    success: failed.length === 0,
  }
}

/**
 * Create a tarball of VFS tools for a platform.
 *
 * @param {object} options - Options.
 * @param {string} options.sourceDir - Source directory containing tools.
 * @param {string} options.outputPath - Output tarball path.
 * @param {string} [options.platform] - Target platform.
 * @param {string} [options.arch] - Target architecture.
 *
 * @returns {Promise<{ success: boolean; size: number }>}
 */
// oxlint-disable-next-line socket/sort-source-methods -- file is ordered by download pipeline phase (parse manifest → fetch → verify checksum → pack); alphabetizing across phases would scatter the download flow.
export async function createVfsToolsTarball({
  arch = process.arch,
  outputPath,
  platform = process.platform,
  sourceDir,
}) {
  const key = getPlatformKey(platform, arch)
  const toolsDir = sourceDir

  if (!existsSync(toolsDir)) {
    throw new Error(`Tools directory not found: ${toolsDir}`)
  }

  logger.info(`Creating VFS tools tarball for ${key}...`)

  // Create output directory
  await fs.mkdir(path.dirname(outputPath), { recursive: true })

  // Create tarball
  await spawn('tar', ['-czf', outputPath, '-C', toolsDir, '.'], {
    stdio: 'pipe',
  })

  // oxlint-disable-next-line socket/prefer-exists-sync -- need stats.size for log output and return value.
  const stats = await fs.stat(outputPath)
  logger.success(
    `Created ${outputPath} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`,
  )

  return { size: stats.size, success: true }
}
