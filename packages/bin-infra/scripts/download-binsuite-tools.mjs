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

import { envIsTrue } from 'build-infra/lib/build-env'
import { ALPINE_RELEASE_FILE } from 'build-infra/lib/constants'
import {
  downloadReleaseAsset,
  getLatestRelease,
} from 'build-infra/lib/github-releases'
import {
  getAssetPlatformArch,
  getPlatformArch,
} from 'build-infra/lib/platform-mappings'

import { WIN32 } from '@socketsecurity/lib/constants/platform'
import { safeDelete, safeDeleteSync, safeMkdir } from '@socketsecurity/lib/fs'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { toUnixPath } from '@socketsecurity/lib/paths/normalize'
import { spawn } from '@socketsecurity/lib/spawn'

const logger = getDefaultLogger()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// All tools download to centralized location: packages/build-infra/build/downloaded/{tool}/{platform-arch}/
const TOOLS = ['binpress', 'binflate', 'binject', 'lief', 'liblzma']

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
 * Get platform-arch string for binary naming using shared mapping.
 *
 * @returns {string} Platform-arch string (e.g., 'linux-x64', 'linux-x64-musl').
 */
function getCurrentPlatformArch() {
  // Use shared platform mapping for consistent naming.
  const libc = isMusl() ? 'musl' : undefined
  return getPlatformArch(process.platform, process.arch, libc)
}

/**
 * Download binary from GitHub release with retry logic.
 */
async function downloadBinary(tool, tag, outputPath) {
  const _platformArch = getCurrentPlatformArch()
  const isLief = tool === 'lief'
  const isLiblzma = tool === 'liblzma'
  const isArchive = isLief || isLiblzma

  // LIEF and liblzma releases are tar.gz archives, binsuite tools are standalone binaries.
  const ext = isArchive ? '.tar.gz' : process.platform === 'win32' ? '.exe' : ''
  // Asset names use shortened platform (win instead of win32)
  const assetPlatformArch = getAssetPlatformArch(
    process.platform,
    process.arch,
    isMusl() ? 'musl' : undefined,
  )
  const assetName = `${tool}-${assetPlatformArch}${ext}`

  logger.info(`Downloading ${tool} ${tag} (${assetName})...`)

  // For archives (LIEF/liblzma), we need the platform-arch directory for extraction.
  // LIEF: binaryName is 'libLIEF.a', so outputPath is .../lief/linux-x64/libLIEF.a
  // liblzma: binaryName is 'lib/liblzma.a', so outputPath is .../liblzma/linux-x64/lib/liblzma.a
  // We need to extract to the platform-arch dir in both cases.
  let downloadDir
  if (isLief) {
    // LIEF: .../lief/linux-x64/libLIEF.a -> .../lief/linux-x64/
    downloadDir = path.dirname(outputPath)
  } else if (isLiblzma) {
    // liblzma: .../liblzma/linux-x64/lib/liblzma.a -> .../liblzma/linux-x64/
    downloadDir = path.dirname(path.dirname(outputPath))
  } else {
    // Regular binaries: just the directory of the output file
    downloadDir = path.dirname(outputPath)
  }
  const downloadPath = isArchive
    ? path.join(downloadDir, assetName)
    : outputPath

  try {
    // Download using Octokit (handles redirects automatically).
    await downloadReleaseAsset(tag, assetName, downloadPath)

    // Verify download.
    if (!existsSync(downloadPath)) {
      throw new Error(`Downloaded file not found at ${downloadPath}`)
    }

    // For LIEF and liblzma, extract the archive.
    if (isArchive) {
      logger.info(`Extracting ${assetName}...`)
      // Extract to downloadDir (the platform-arch directory).
      // LIEF tarball: libLIEF.a and include/ at root
      // liblzma tarball: lib/liblzma.a and include/ at root
      const extractDir = downloadDir

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
      await safeDelete(downloadPath)

      // Write version file after extraction.
      const versionPath = path.join(extractDir, '.version')
      await fs.writeFile(versionPath, tag, 'utf8')

      const toolLabel = isLief ? 'LIEF' : 'liblzma'
      logger.success(`Extracted ${toolLabel} library to ${extractDir}`)
      return true
    }

    // For binsuite tools, make executable on Unix.
    if (process.platform !== 'win32') {
      await fs.chmod(outputPath, 0o755)
    }

    const stats = await fs.stat(outputPath)
    const sizeMB = (stats.size / 1024 / 1024).toFixed(2)
    logger.success(`Downloaded ${tool} (${sizeMB} MB)`)

    // Write .version file for binsuite tools.
    const versionPath = path.join(path.dirname(outputPath), '.version')
    await fs.writeFile(versionPath, tag, 'utf8')
    logger.info(`Wrote version file: ${versionPath}`)

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
 *
 * Environment variables:
 * - BUILD_TOOLS_FROM_SOURCE=true: Skip downloading binsuite tools (binpress/binflate/binject),
 *   require locally built versions. Used in Docker builds to test local changes.
 *   LIEF/liblzma downloads are still allowed.
 * - BUILD_DEPS_FROM_SOURCE=true: Skip downloading LIEF and liblzma,
 *   require these to be pre-installed on the system or built from source.
 * - BUILD_ALL_FROM_SOURCE=true: Shortcut for both BUILD_TOOLS_FROM_SOURCE and BUILD_DEPS_FROM_SOURCE.
 */
async function ensureTool(tool, force = false) {
  const isLief = tool === 'lief'
  const isLiblzma = tool === 'liblzma'
  const isBuildDep = isLief || isLiblzma
  const isBinsuiteTool = !isBuildDep

  const buildAllFromSource = envIsTrue(process.env.BUILD_ALL_FROM_SOURCE)
  const buildToolsFromSource =
    buildAllFromSource || envIsTrue(process.env.BUILD_TOOLS_FROM_SOURCE)
  const buildDepsFromSource =
    buildAllFromSource || envIsTrue(process.env.BUILD_DEPS_FROM_SOURCE)

  // Check if download is blocked by environment
  if (isBinsuiteTool && buildToolsFromSource) {
    logger.fail(
      `${tool} download blocked by BUILD_TOOLS_FROM_SOURCE=true.\n` +
        `Build ${tool} locally first:\n` +
        `  pnpm --filter ${tool} build\n` +
        'Or unset BUILD_TOOLS_FROM_SOURCE to allow downloading from releases.',
    )
    return false
  }

  if (isBuildDep && buildDepsFromSource) {
    logger.fail(
      `${tool} download blocked by BUILD_DEPS_FROM_SOURCE=true.\n` +
        'Install system-wide or unset BUILD_DEPS_FROM_SOURCE to allow downloading.',
    )
    return false
  }

  // All tools download to centralized location: packages/build-infra/build/downloaded/{tool}/{platform-arch}/
  const platformArch = getCurrentPlatformArch()
  // Navigate from packages/bin-infra/scripts/ to packages/build-infra/
  const buildInfraDir = path.join(__dirname, '../../build-infra')
  const downloadDir = path.join(
    buildInfraDir,
    'build',
    'downloaded',
    tool,
    platformArch,
  )
  // LIEF and liblzma extract to lib/ subdirectory
  const binaryName = isLief
    ? 'libLIEF.a'
    : isLiblzma
      ? 'lib/liblzma.a'
      : `${tool}${process.platform === 'win32' ? '.exe' : ''}`
  const binaryPath = path.join(downloadDir, binaryName)

  // Check if binary already exists and version matches.
  if (!force && existsSync(binaryPath)) {
    // Version file is in the download dir root, not next to the binary for archives
    const versionPath = path.join(downloadDir, '.version')
    if (existsSync(versionPath)) {
      const currentVersion = (await fs.readFile(versionPath, 'utf8')).trim()
      const latestTag = await getLatestRelease(tool)
      if (currentVersion === latestTag) {
        logger.success(
          `${tool} ${currentVersion} already exists at ${binaryPath}`,
        )
        return true
      }
      logger.info(
        `${tool} version mismatch (have: ${currentVersion}, latest: ${latestTag}), re-downloading...`,
      )
    } else {
      logger.info(`${tool} exists but no version file found, re-downloading...`)
    }
  }

  // Create output directory.
  const targetDir = path.dirname(binaryPath)
  await safeMkdir(targetDir)

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
  const toolFilter = toolArg ? toolArg.split('=')[1] : undefined

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
