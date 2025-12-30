#!/usr/bin/env node
/**
 * Download prebuilt binsuite tools (binpress, binflate, binject, lief) from GitHub releases.
 *
 * This script checks for the latest release of each tool and downloads the appropriate
 * platform-arch binary. Fails if prebuilt binary is not available.
 *
 * Usage:
 *   node download-binsuite-tools.mjs [--tool=binpress|binflate|binject|lief] [--force]
 */

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { getBinOutDir } from 'build-infra/lib/constants'
import { ALPINE_RELEASE_FILE } from 'build-infra/lib/environment-constants'
import {
  downloadReleaseAsset,
  getLatestRelease,
} from 'build-infra/lib/github-releases'

import { WIN32 } from '@socketsecurity/lib/constants/platform'
import { safeDeleteSync } from '@socketsecurity/lib/fs'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { toUnixPath } from '@socketsecurity/lib/paths/normalize'
import { spawn } from '@socketsecurity/lib/spawn'

const logger = getDefaultLogger()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

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
  if (existsSync(ALPINE_RELEASE_FILE)) {
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
 * Download binary from GitHub release with retry logic.
 */
async function downloadBinary(tool, tag, outputPath) {
  const platformArch = getPlatformArch()
  const isLief = tool === 'lief'

  // LIEF releases are tar.gz archives, binsuite tools are standalone binaries.
  const ext = isLief ? '.tar.gz' : process.platform === 'win32' ? '.exe' : ''
  const assetName = `${tool}-${platformArch}${ext}`

  logger.info(`Downloading ${tool} ${tag} (${assetName})...`)

  const downloadDir = path.dirname(
    isLief ? path.join(path.dirname(outputPath), assetName) : outputPath,
  )
  const downloadPath = isLief ? path.join(downloadDir, assetName) : outputPath

  try {
    // Download using Octokit (handles redirects automatically).
    await downloadReleaseAsset(tag, assetName, downloadPath)

    // Verify download.
    if (!existsSync(downloadPath)) {
      throw new Error(`Downloaded file not found at ${downloadPath}`)
    }

    // For LIEF, extract the archive.
    if (isLief) {
      logger.info(`Extracting ${assetName}...`)
      const extractDir = path.dirname(outputPath)

      // Extract tar.gz.
      // Convert paths to forward slashes on Windows for tar compatibility.
      const tarResult = await spawn(
        'tar',
        ['-xzf', toTarPath(downloadPath), '-C', toTarPath(extractDir)],
        { stdio: 'inherit' },
      )

      if (tarResult.code !== 0) {
        throw new Error(
          `tar extraction failed with exit code ${tarResult.code}`,
        )
      }

      // Remove the archive.
      await fs.unlink(downloadPath)

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
    logger.warn(`Failed to download ${tool}: ${e.message}`)

    // Clean up partial download if it exists.
    if (existsSync(downloadPath)) {
      try {
        safeDeleteSync(downloadPath)
      } catch {
        // Ignore cleanup errors.
      }
    }

    return false
  }
}

/**
 * Download or build a tool.
 */
async function ensureTool(tool, force = false) {
  const isLief = tool === 'lief'

  // LIEF is in bin-infra, other tools in their own packages.
  const toolDir = isLief
    ? path.join(__dirname, '..')
    : path.join(__dirname, '../..', tool)

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
