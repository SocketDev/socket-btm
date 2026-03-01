/**
 * VFS External Tools Downloader
 *
 * Downloads pre-built security tools (Python, Trivy, TruffleHog, OpenGrep)
 * for bundling into VFS archives across all platforms.
 *
 * Usage: socket-cli and other consumers can use this to download platform-specific
 * tool binaries for VFS embedding.
 */

import { createWriteStream, existsSync, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'

import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

const logger = getDefaultLogger()

/**
 * VFS tool download URLs for each platform.
 * Windows uses official portable/embeddable distributions.
 */
export const VFS_TOOL_URLS = {
  /**
   * Python embeddable packages (official Python.org releases)
   * Windows: embeddable zip (no installation needed)
   * Other platforms: should use system Python or pyenv
   */
  python: {
    version: '3.11.9',
    'win32-x64':
      'https://www.python.org/ftp/python/3.11.9/python-3.11.9-embed-amd64.zip',
    'win32-arm64':
      'https://www.python.org/ftp/python/3.11.9/python-3.11.9-embed-arm64.zip',
  },

  /**
   * Trivy vulnerability scanner (Aqua Security)
   * GitHub releases provide pre-built binaries for all platforms
   */
  trivy: {
    version: '0.50.4',
    'win32-x64':
      'https://github.com/aquasecurity/trivy/releases/download/v0.50.4/trivy_0.50.4_Windows-64bit.zip',
    'win32-arm64':
      'https://github.com/aquasecurity/trivy/releases/download/v0.50.4/trivy_0.50.4_Windows-ARM64.zip',
    'darwin-x64':
      'https://github.com/aquasecurity/trivy/releases/download/v0.50.4/trivy_0.50.4_macOS-64bit.tar.gz',
    'darwin-arm64':
      'https://github.com/aquasecurity/trivy/releases/download/v0.50.4/trivy_0.50.4_macOS-ARM64.tar.gz',
    'linux-x64':
      'https://github.com/aquasecurity/trivy/releases/download/v0.50.4/trivy_0.50.4_Linux-64bit.tar.gz',
    'linux-arm64':
      'https://github.com/aquasecurity/trivy/releases/download/v0.50.4/trivy_0.50.4_Linux-ARM64.tar.gz',
  },

  /**
   * TruffleHog secrets scanner (Truffle Security)
   * GitHub releases provide pre-built binaries for all platforms
   */
  trufflehog: {
    version: '3.78.1',
    'win32-x64':
      'https://github.com/trufflesecurity/trufflehog/releases/download/v3.78.1/trufflehog_3.78.1_windows_amd64.tar.gz',
    'win32-arm64':
      'https://github.com/trufflesecurity/trufflehog/releases/download/v3.78.1/trufflehog_3.78.1_windows_arm64.tar.gz',
    'darwin-x64':
      'https://github.com/trufflesecurity/trufflehog/releases/download/v3.78.1/trufflehog_3.78.1_darwin_amd64.tar.gz',
    'darwin-arm64':
      'https://github.com/trufflesecurity/trufflehog/releases/download/v3.78.1/trufflehog_3.78.1_darwin_arm64.tar.gz',
    'linux-x64':
      'https://github.com/trufflesecurity/trufflehog/releases/download/v3.78.1/trufflehog_3.78.1_linux_amd64.tar.gz',
    'linux-arm64':
      'https://github.com/trufflesecurity/trufflehog/releases/download/v3.78.1/trufflehog_3.78.1_linux_arm64.tar.gz',
  },

  /**
   * OpenGrep code scanner (Semgrep fork)
   * Note: OpenGrep releases may have different naming - verify URLs
   */
  opengrep: {
    version: '1.64.0',
    // OpenGrep binary names follow semgrep patterns
    'darwin-x64':
      'https://github.com/opengrep/opengrep/releases/download/v1.64.0/opengrep-1.64.0-osx-x86_64.zip',
    'darwin-arm64':
      'https://github.com/opengrep/opengrep/releases/download/v1.64.0/opengrep-1.64.0-osx-arm64.zip',
    'linux-x64':
      'https://github.com/opengrep/opengrep/releases/download/v1.64.0/opengrep-1.64.0-ubuntu-22.04-x86_64.tar.gz',
    'linux-arm64':
      'https://github.com/opengrep/opengrep/releases/download/v1.64.0/opengrep-1.64.0-ubuntu-22.04-aarch64.tar.gz',
    // Windows support may be limited - check releases
    'win32-x64': undefined,
    'win32-arm64': undefined,
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

  let lastError

  // Retry loop for transient failures (rate limits, server errors)
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Use fetch API (Node 18+) with timeout
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), timeout)

      try {
        // eslint-disable-next-line no-await-in-loop -- Sequential retries required
        const response = await fetch(url, {
          headers: {
            'User-Agent': 'socket-btm-vfs-tools-downloader/1.0',
          },
          redirect: 'follow',
          signal: controller.signal,
        })

        clearTimeout(timeoutId)

        if (!response.ok) {
          // Retry on 429 (rate limit) or 5xx errors
          if (response.status === 429 || response.status >= 500) {
            throw new Error(
              `HTTP ${response.status}: ${response.statusText} (retryable)`,
            )
          }
          throw new Error(`HTTP ${response.status}: ${response.statusText}`)
        }

        // Create parent directory
        // eslint-disable-next-line no-await-in-loop -- Sequential retries required
        await fs.mkdir(path.dirname(destPath), { recursive: true })

        // Stream to file
        const fileStream = createWriteStream(destPath)
        // eslint-disable-next-line no-await-in-loop -- Sequential retries required
        await pipeline(response.body, fileStream)

        // Verify file was written
        // eslint-disable-next-line no-await-in-loop -- Sequential retries required
        const stats = await fs.stat(destPath)
        if (stats.size === 0) {
          throw new Error('Downloaded file is empty')
        }

        // Success
        return
      } finally {
        clearTimeout(timeoutId)
      }
    } catch (error) {
      lastError = error

      // Don't retry on abort (timeout) or non-retryable errors
      const isRetryable =
        error.name === 'AbortError' ||
        error.message.includes('retryable') ||
        error.code === 'ECONNRESET' ||
        error.code === 'ETIMEDOUT'

      if (!isRetryable || attempt === maxRetries) {
        break
      }

      // Exponential backoff
      const delay = RETRY_DELAY_MS * 2 ** (attempt - 1)
      logger.warn(
        `Download attempt ${attempt} failed, retrying in ${delay}ms: ${error.message}`,
      )
      // eslint-disable-next-line no-await-in-loop -- Sequential retries required
      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }

  throw lastError
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
    // Use unzip command
    const unzipPath = process.platform === 'win32' ? 'powershell' : 'unzip'

    if (process.platform === 'win32') {
      const result = await spawn(
        unzipPath,
        [
          '-Command',
          `Expand-Archive -Path "${archivePath}" -DestinationPath "${destDir}" -Force`,
        ],
        { stdio: 'pipe' },
      )
      if (result.code !== 0) {
        throw new Error(`Expand-Archive failed with code ${result.code}`)
      }
    } else {
      const result = await spawn(
        unzipPath,
        ['-o', archivePath, '-d', destDir],
        {
          stdio: 'pipe',
        },
      )
      if (result.code !== 0) {
        throw new Error(`unzip failed with code ${result.code}`)
      }
    }
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
 * @returns {Promise<{success: boolean, toolDir: string, version: string}>}
 */
export async function downloadVfsTool(
  toolName,
  { arch = process.arch, destDir, force = false, platform = process.platform },
) {
  const toolConfig = VFS_TOOL_URLS[toolName]
  if (!toolConfig) {
    throw new Error(`Unknown VFS tool: ${toolName}`)
  }

  const key = getPlatformKey(platform, arch)
  const url = toolConfig[key]

  if (!url) {
    logger.warn(`${toolName} not available for ${key}`)
    return { success: false, toolDir: '', version: toolConfig.version }
  }

  const version = toolConfig.version
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

    // Clean destination and extract
    await fs.rm(toolDir, { recursive: true, force: true })
    await extractArchive(archivePath, toolDir)

    // Write version marker
    await fs.writeFile(versionFile, version)

    logger.success(`Downloaded ${toolName} ${version} for ${key}`)
    return { success: true, toolDir, version }
  } finally {
    // Cleanup temp directory
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
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
    } catch (error) {
      logger.error(`Failed to download ${toolName}: ${error.message}`)
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

  return { success: true, size: stats.size }
}
