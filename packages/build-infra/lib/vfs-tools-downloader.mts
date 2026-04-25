/**
 * VFS External Tools Downloader
 *
 * Downloads pre-built security tools (Python, Trivy, TruffleHog, OpenGrep)
 * for bundling into VFS archives across all platforms.
 *
 * Usage: socket-cli and other consumers can use this to download platform-specific
 * tool binaries for VFS embedding.
 */

import crypto from 'node:crypto'
import { createReadStream, existsSync, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import AdmZip from 'adm-zip'
import process from 'node:process'

import { safeDelete } from '@socketsecurity/lib/fs'
import { httpDownload } from '@socketsecurity/lib/http-request'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

import { errorMessage } from './error-utils.mts'

const logger = getDefaultLogger()

/**
 * VFS tool download URLs for each platform with SHA256 checksums.
 * Windows uses official portable/embeddable distributions.
 *
 * SECURITY: All downloads MUST have SHA256 checksums for integrity verification.
 * Checksums should be obtained from official release pages or computed from
 * known-good downloads.
 */
export const VFS_TOOL_URLS = {
  /**
   * Python embeddable packages (official Python.org releases)
   * Windows: embeddable zip (no installation needed)
   * Other platforms: should use system Python or pyenv
   * Checksums from: https://www.python.org/downloads/release/python-3119/
   */
  python: {
    version: '3.11.9',
    'win32-arm64': {
      url: 'https://www.python.org/ftp/python/3.11.9/python-3.11.9-embed-arm64.zip',
      sha256:
        '1a6dae49d15320270a7141f93b574ff7686a7a526efa65e63ddbebf9b409929a',
    },
    'win32-x64': {
      url: 'https://www.python.org/ftp/python/3.11.9/python-3.11.9-embed-amd64.zip',
      sha256:
        '009d6bf7e3b2ddca3d784fa09f90fe54336d5b60f0e0f305c37f400bf83cfd3b',
    },
  },

  /**
   * Trivy vulnerability scanner (Aqua Security)
   * GitHub releases provide pre-built binaries for all platforms
   * Checksums from: https://github.com/aquasecurity/trivy/releases/tag/v0.50.4
   */
  trivy: {
    version: '0.69.3',
    'win32-x64': {
      sha256:
        '74362dc711383255308230ecbeb587eb1e4e83a8d332be5b0259afac6e0c2224',
      url: 'https://github.com/aquasecurity/trivy/releases/download/v0.69.3/trivy_0.69.3_windows-64bit.zip',
    },
    // Not available in this release
    'win32-arm64': undefined,
    'darwin-x64': {
      sha256:
        'fec4a9f7569b624dd9d044fca019e5da69e032700edbb1d7318972c448ec2f4e',
      url: 'https://github.com/aquasecurity/trivy/releases/download/v0.69.3/trivy_0.69.3_macOS-64bit.tar.gz',
    },
    'darwin-arm64': {
      sha256:
        'a2f2179afd4f8bb265ca3c7aefb56a666bc4a9a411663bc0f22c3549fbc643a5',
      url: 'https://github.com/aquasecurity/trivy/releases/download/v0.69.3/trivy_0.69.3_macOS-ARM64.tar.gz',
    },
    'linux-x64': {
      sha256:
        '1816b632dfe529869c740c0913e36bd1629cb7688bd5634f4a858c1d57c88b75',
      url: 'https://github.com/aquasecurity/trivy/releases/download/v0.69.3/trivy_0.69.3_Linux-64bit.tar.gz',
    },
    'linux-arm64': {
      sha256:
        '7e3924a974e912e57b4a99f65ece7931f8079584dae12eb7845024f97087bdfd',
      url: 'https://github.com/aquasecurity/trivy/releases/download/v0.69.3/trivy_0.69.3_Linux-ARM64.tar.gz',
    },
  },

  /**
   * TruffleHog secrets scanner (Truffle Security)
   * GitHub releases provide pre-built binaries for all platforms
   * Checksums from: https://github.com/trufflesecurity/trufflehog/releases/tag/v3.78.1
   */
  trufflehog: {
    'darwin-arm64': {
      url: 'https://github.com/trufflesecurity/trufflehog/releases/download/v3.93.7/trufflehog_3.93.7_darwin_arm64.tar.gz',
      sha256:
        '1f742b04c0c08fa9e199c3b6ca9e4ccfd639f439689673ad52add698d266c9ff',
    },
    'darwin-x64': {
      url: 'https://github.com/trufflesecurity/trufflehog/releases/download/v3.93.7/trufflehog_3.93.7_darwin_amd64.tar.gz',
      sha256:
        '064fd3bcab3a4e480a4bdb988a8b8338f3aa1f91ebd4ef3484416e0b7b2c3255',
    },
    'linux-arm64': {
      url: 'https://github.com/trufflesecurity/trufflehog/releases/download/v3.93.7/trufflehog_3.93.7_linux_arm64.tar.gz',
      sha256:
        '8a0fba600d564912e3d7450766847e4ce0d7cda08edd44c346eb899c71ace067',
    },
    'linux-x64': {
      url: 'https://github.com/trufflesecurity/trufflehog/releases/download/v3.93.7/trufflehog_3.93.7_linux_amd64.tar.gz',
      sha256:
        'a87e178a2643238e31bee50261b681e29f0d502c00deb10055bd7570413e0a87',
    },
    version: '3.93.7',
    'win32-arm64': {
      url: 'https://github.com/trufflesecurity/trufflehog/releases/download/v3.93.7/trufflehog_3.93.7_windows_arm64.tar.gz',
      sha256:
        '72cbc127092f71f463aa0c1f6efcdc81c9cd8935221d92548d21335b02117874',
    },
    'win32-x64': {
      url: 'https://github.com/trufflesecurity/trufflehog/releases/download/v3.93.7/trufflehog_3.93.7_windows_amd64.tar.gz',
      sha256:
        '4f86826ce52230fca38eaac12c18e5572d404f017215a62d0784e800fcf05365',
    },
  },

  /**
   * OpenGrep code scanner (Semgrep fork)
   * Note: OpenGrep releases may have different naming - verify URLs
   * Checksums from: https://github.com/opengrep/opengrep/releases/tag/v1.64.0
   */
  opengrep: {
    'darwin-arm64': {
      url: 'https://github.com/opengrep/opengrep/releases/download/v1.16.3/opengrep-core_osx_aarch64.tar.gz',
      sha256:
        'ba78a28fd035ddb8bf6a89c91c3b66589abe94716140def4369a32ff57dd7d2f',
    },
    'darwin-x64': {
      url: 'https://github.com/opengrep/opengrep/releases/download/v1.16.3/opengrep-core_osx_x86.tar.gz',
      sha256:
        'c96d9238e352d2516544f9c213b9d0fc27448899da55489664048abd132b1c5e',
    },
    'linux-arm64': {
      url: 'https://github.com/opengrep/opengrep/releases/download/v1.16.3/opengrep-core_linux_aarch64.tar.gz',
      sha256:
        '5d3d52ff86ab231e43503e0e1aca76085f95c2ff4b03755a6816a13ee7e4f125',
    },
    'linux-x64': {
      url: 'https://github.com/opengrep/opengrep/releases/download/v1.16.3/opengrep-core_linux_x86.tar.gz',
      sha256:
        '2b97cda3b4a6794c04aad58932d3a8df07bc43e11afbb0bfb869bb0c7c95e41e',
    },
    version: '1.16.3',
    'win32-x64': {
      url: 'https://github.com/opengrep/opengrep/releases/download/v1.16.3/opengrep-core_windows_x86.zip',
      sha256:
        '9b3031b0e40725a4a976491fd968a4f9a6f6f964a5b6eadb0b704478b6bc3c22',
    },
  },
}

/**
 * Get platform key for VFS tool URLs.
 *
 * @param {string} [platform] - Platform (darwin, linux, win32)
 * @param {string} [arch] - Architecture (x64, arm64)
 * @returns {string} Platform-arch key (e.g., "win32-x64")
 */
export function getPlatformKey(
  platform = process.platform,
  arch = process.arch,
) {
  return `${platform}-${arch}`
}

/**
 * Get available tools for a platform.
 *
 * @param {string} [platform] - Platform (darwin, linux, win32)
 * @param {string} [arch] - Architecture (x64, arm64)
 * @returns {string[]} Array of tool names available for this platform
 */
export function getAvailableTools(
  platform = process.platform,
  arch = process.arch,
) {
  const key = getPlatformKey(platform, arch)
  const tools = []

  for (const [toolName, config] of Object.entries(VFS_TOOL_URLS)) {
    if (config[key]) {
      tools.push(toolName)
    }
  }

  return tools
}

/** Default download timeout: 5 minutes */
const DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000

/** Maximum retry attempts for transient errors */
const MAX_RETRIES = 3

/** Delay between retries (exponential backoff base) */
const RETRY_DELAY_MS = 1000

/**
 * Compute SHA256 hash of a file.
 *
 * @param {string} filePath - Path to file
 * @returns {Promise<string>} Hex-encoded SHA256 hash
 */
async function computeFileSha256(filePath) {
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
 * @param {string} filePath - Path to file
 * @param {string} expectedHash - Expected SHA256 hash (hex)
 * @returns {Promise<boolean>} True if hash matches
 */
async function verifyFileSha256(filePath, expectedHash) {
  const actualHash = await computeFileSha256(filePath)
  return actualHash.toLowerCase() === expectedHash.toLowerCase()
}

/**
 * Download a file from URL to destination with timeout and retry.
 *
 * @param {string} url - URL to download
 * @param {string} destPath - Destination file path
 * @param {object} [options] - Download options
 * @param {number} [options.timeout] - Timeout in ms (default: 5 minutes)
 * @param {number} [options.retries] - Max retries (default: 3)
 * @returns {Promise<void>}
 */
async function downloadFile(url, destPath, options = {}) {
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
 * @param {string} archivePath - Path to archive file
 * @param {string} destDir - Destination directory
 * @returns {Promise<void>}
 */
async function extractArchive(archivePath, destDir) {
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
 * @param {object} options - Options
 * @param {string} options.destDir - Destination directory
 * @param {string} [options.platform] - Target platform (defaults to current)
 * @param {string} [options.arch] - Target architecture (defaults to current)
 * @param {boolean} [options.force] - Force re-download even if exists
 * @param {boolean} [options.skipHashVerification] - Skip SHA256 verification (NOT RECOMMENDED)
 * @returns {Promise<{success: boolean, toolDir: string, version: string}>}
 */
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
 * @param {object} options - Options
 * @param {string} options.destDir - Destination directory
 * @param {string} [options.platform] - Target platform (defaults to current)
 * @param {string} [options.arch] - Target architecture (defaults to current)
 * @param {string[]} [options.tools] - Specific tools to download (defaults to all available)
 * @param {boolean} [options.force] - Force re-download even if exists
 * @returns {Promise<{success: boolean, downloaded: string[], failed: string[]}>}
 */
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
 * @param {object} options - Options
 * @param {string} options.sourceDir - Source directory containing tools
 * @param {string} options.outputPath - Output tarball path
 * @param {string} [options.platform] - Target platform
 * @param {string} [options.arch] - Target architecture
 * @returns {Promise<{success: boolean, size: number}>}
 */
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

  const stats = await fs.stat(outputPath)
  logger.success(
    `Created ${outputPath} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`,
  )

  return { size: stats.size, success: true }
}
