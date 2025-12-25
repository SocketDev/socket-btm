#!/usr/bin/env node
/**
 * Download prebuilt binsuite tools (binpress, binflate, binject) from GitHub releases.
 *
 * This script checks for the latest release of each tool and downloads the appropriate
 * platform-arch binary. If a prebuilt binary is not available, it falls back to building
 * from source.
 *
 * Usage:
 *   node download-binsuite-tools.mjs [--tool=binpress|binflate|binject] [--force]
 */

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { getBinOutDir } from 'build-infra/lib/constants'

import { WIN32 } from '@socketsecurity/lib/constants/platform'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { toUnixPath } from '@socketsecurity/lib/paths/normalize'
import { spawn } from '@socketsecurity/lib/spawn'

const logger = getDefaultLogger()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const REPO = 'SocketDev/socket-btm'
const TOOLS = ['binpress', 'binflate', 'binject', 'lief']

/**
 * Convert Windows paths to Unix-style for Git Bash tar.
 * Git Bash tar on Windows requires /d/path format, not D:/path.
 */
function toTarPath(p) {
  if (!WIN32) {
    return p
  }
  // Convert to Git Bash format: D:\path → /d/path.
  // Git Bash tar interprets D: as a hostname, so we need Unix-style paths.
  return toUnixPath(p)
}

/**
 * Detect if running on musl libc (Alpine Linux).
 */
function isMusl() {
  if (process.platform !== 'linux') {
    return false
  }

  // Check for Alpine release file.
  if (existsSync('/etc/alpine-release')) {
    return true
  }

  // Check ldd version for musl.
  try {
    const { execSync } = require('node:child_process')
    const lddVersion = execSync('ldd --version 2>&1', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    return lddVersion.includes('musl')
  } catch {
    return false
  }
}

/**
 * Get platform-arch string for binary naming.
 */
function getPlatformArch() {
  const platform = process.platform
  const arch = process.arch

  // Map Node.js platform names to release names.
  // All tools use consistent naming: win (not win32).
  const platformMap = {
    __proto__: null,
    darwin: 'darwin',
    linux: 'linux',
    win32: 'win',
  }

  // Map Node.js arch names to release names.
  const archMap = {
    __proto__: null,
    arm64: 'arm64',
    x64: 'x64',
  }

  const releasePlatform = platformMap[platform]
  const releaseArch = archMap[arch]

  if (!releasePlatform || !releaseArch) {
    throw new Error(`Unsupported platform/arch: ${platform}/${arch}`)
  }

  // Append -musl for musl libc on Linux.
  const muslSuffix = isMusl() ? '-musl' : ''

  return `${releasePlatform}-${releaseArch}${muslSuffix}`
}

/**
 * Get latest release tag for a tool with retry logic.
 */
async function getLatestRelease(tool) {
  const MAX_RETRIES = 3
  // 5 seconds.
  const RETRY_DELAY = 5000
  let lastError = null

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (attempt > 1) {
        logger.info(
          `  Retry attempt ${attempt}/${MAX_RETRIES} for ${tool} release list...`,
        )
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY))
      }

      const result = await spawn(
        'gh',
        ['release', 'list', '--repo', REPO, '--limit', '100'],
        { stdio: 'pipe' },
      )

      if (result.code !== 0) {
        const errorMsg = result.stderr?.trim() || 'unknown error'
        throw new Error(`gh release list failed: ${errorMsg}`)
      }

      if (!result.stdout || result.stdout.trim() === '') {
        throw new Error('gh release list returned empty output')
      }

      // Parse gh release list output (tab-separated: title, type, tag, date).
      const lines = result.stdout.trim().split('\n')
      for (const line of lines) {
        const [, , tag] = line.split('\t')
        if (tag?.startsWith(`${tool}-`)) {
          logger.info(`  Found release: ${tag}`)
          return tag
        }
      }

      // No matching release found in the list.
      logger.info(`  No ${tool} release found in latest 100 releases`)
      return null
    } catch (e) {
      lastError = e
      if (attempt < MAX_RETRIES) {
        logger.warn(`  Attempt ${attempt}/${MAX_RETRIES} failed: ${e.message}`)
      }
    }
  }

  logger.warn(
    `Failed to get latest release for ${tool} after ${MAX_RETRIES} attempts: ${lastError.message}`,
  )
  return null
}

/**
 * Download binary from GitHub release with retry logic.
 */
async function downloadBinary(tool, tag, outputPath) {
  const platformArch = getPlatformArch()
  const isLief = tool === 'lief'

  // LIEF releases are tar.gz archives, binsuite tools are standalone binaries.
  const ext = isLief ? '.tar.gz' : process.platform === 'win32' ? '.exe' : ''
  const assetName = `${tool}-${platformArch}${ext}`

  logger.info(`Downloading ${tool} ${tag} (${assetName})...`)

  const MAX_RETRIES = 3
  // 5 seconds.
  const RETRY_DELAY = 5000
  let lastError = null

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (attempt > 1) {
        logger.info(`  Retry attempt ${attempt}/${MAX_RETRIES}...`)
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY))
      }

      const downloadPath = isLief
        ? path.join(path.dirname(outputPath), assetName)
        : outputPath

      // Download using gh release download.
      const downloadDir = path.dirname(downloadPath)
      const result = await spawn(
        'gh',
        [
          'release',
          'download',
          tag,
          '--repo',
          REPO,
          '--pattern',
          assetName,
          '--dir',
          downloadDir,
        ],
        { stdio: 'inherit' },
      )

      if (result.code !== 0) {
        throw new Error(
          `gh release download failed with exit code ${result.code}`,
        )
      }

      // File is downloaded with its asset name in the directory.
      const actualDownloadPath = path.join(downloadDir, assetName)

      // Verify download.
      if (!existsSync(actualDownloadPath)) {
        throw new Error(`Downloaded asset not found at ${actualDownloadPath}`)
      }

      // For non-LIEF tools, rename from asset name to desired output name if different.
      if (!isLief && actualDownloadPath !== outputPath) {
        await fs.rename(actualDownloadPath, outputPath)
      }

      // For LIEF, extract the archive.
      if (isLief) {
        logger.info(`Extracting ${assetName}...`)
        const extractDir = path.dirname(outputPath)

        // Extract tar.gz.
        // Convert paths to forward slashes on Windows for tar compatibility.
        const tarResult = await spawn(
          'tar',
          ['-xzf', toTarPath(actualDownloadPath), '-C', toTarPath(extractDir)],
          { stdio: 'inherit' },
        )

        if (tarResult.code !== 0) {
          throw new Error(
            `tar extraction failed with exit code ${tarResult.code}`,
          )
        }

        // Remove the archive.
        await fs.unlink(actualDownloadPath)

        logger.success(`Extracted LIEF library to ${extractDir}`)
        return true
      }

      // For binsuite tools, make executable on Unix.
      if (process.platform !== 'win32') {
        await fs.chmod(outputPath, 0o755)
      }

      const stats = await fs.stat(outputPath)
      const sizeMB = (stats.size / 1024 / 1024).toFixed(2)
      logger.success(`Downloaded ${tool} (${sizeMB} MB)`)

      return true
    } catch (e) {
      lastError = e
      if (attempt < MAX_RETRIES) {
        logger.warn(`  Attempt ${attempt}/${MAX_RETRIES} failed: ${e.message}`)
        // Clean up partial download if it exists.
        const downloadDir = path.dirname(
          isLief ? path.join(path.dirname(outputPath), assetName) : outputPath,
        )
        const partialDownloadPath = path.join(downloadDir, assetName)
        if (existsSync(partialDownloadPath)) {
          try {
            await fs.unlink(partialDownloadPath)
          } catch {
            // Ignore cleanup errors.
          }
        }
      }
    }
  }

  logger.warn(
    `Failed to download ${tool} after ${MAX_RETRIES} attempts: ${lastError.message}`,
  )
  return false
}

/**
 * Download or build a tool.
 */
async function ensureTool(tool, force = false) {
  const isLief = tool === 'lief'

  // LIEF is in bin-infra, other tools in their own packages.
  const toolDir = isLief
    ? path.join(__dirname, '../../../..', 'bin-infra')
    : path.join(__dirname, '../../../..', tool)

  const outDir = getBinOutDir(toolDir)
  const ext = process.platform === 'win32' ? '.exe' : ''
  const binaryName = isLief ? 'libLIEF.a' : `${tool}${ext}`
  const binaryPath = path.join(outDir, isLief ? 'lief' : '', binaryName)

  // Check if binary already exists.
  if (!force && existsSync(binaryPath)) {
    logger.success(`${tool} already exists at ${binaryPath}`)
    return true
  }

  // Create output directory.
  const targetDir = path.dirname(binaryPath)
  await fs.mkdir(targetDir, { recursive: true })

  // Try to download from releases.
  const tag = await getLatestRelease(tool)
  if (tag) {
    const downloaded = await downloadBinary(tool, tag, binaryPath)
    if (downloaded) {
      return true
    }
  }

  // Prebuilt binaries must be downloaded from releases.
  // Building from source is not supported as a fallback to ensure
  // consistent binaries and avoid complex build dependencies in CI.
  const platformName =
    process.platform === 'win32'
      ? 'Windows'
      : process.platform === 'darwin'
        ? 'macOS'
        : 'Linux'
  logger.fail(
    `${tool} is not available for ${platformName}. Prebuilt binaries must be downloaded from releases.`,
  )
  return false
}

/**
 * Main entry point.
 */
async function main() {
  const args = process.argv.slice(2)
  const force = args.includes('--force')
  const toolArg = args.find(arg => arg.startsWith('--tool='))
  const toolFilter = toolArg ? toolArg.split('=')[1] : null

  const toolsToEnsure = toolFilter ? [toolFilter] : TOOLS

  // Validate tool names.
  for (const tool of toolsToEnsure) {
    if (!TOOLS.includes(tool)) {
      logger.fail(`Unknown tool: ${tool}`)
      logger.info(`Valid tools: ${TOOLS.join(', ')}`)
      process.exit(1)
    }
  }

  logger.info('🔧 Ensuring binsuite tools are available...\n')

  let allSuccess = true
  for (const tool of toolsToEnsure) {
    const success = await ensureTool(tool, force)
    if (!success) {
      allSuccess = false
    }
    logger.info('')
  }

  if (allSuccess) {
    logger.success('✅ All tools are ready')
  } else {
    logger.fail('❌ Some tools failed to download or build')
    process.exit(1)
  }
}

main().catch(e => {
  logger.fail(`Error: ${e.message}`)
  process.exit(1)
})
