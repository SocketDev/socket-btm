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

import { checkBuildSourceFlag } from 'build-infra/lib/build-env'
import {
  downloadReleaseAsset,
  getLatestRelease,
} from 'build-infra/lib/github-releases'
import {
  getAssetPlatformArch,
  getPlatformArch,
  isMusl,
} from 'build-infra/lib/platform-mappings'
import { toTarPath } from 'build-infra/lib/tarball-utils'

import { safeDelete, safeDeleteSync, safeMkdir } from '@socketsecurity/lib/fs'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { downloadSocketBtmRelease } from '@socketsecurity/lib/releases/socket-btm'
import { spawn } from '@socketsecurity/lib/spawn'

const logger = getDefaultLogger()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// All tools download to centralized location: packages/build-infra/build/downloaded/{tool}/{platform-arch}/
const BINSUITE_TOOLS = ['binpress', 'binflate', 'binject']
const TOOLS = [...BINSUITE_TOOLS, 'lief']

/**
 * Download LIEF library from GitHub release.
 * LIEF requires special handling as it's a tar.gz archive that needs extraction.
 */
async function downloadLief(tag, outputPath) {
  // Support cross-compilation via TARGET_ARCH environment variable.
  const targetArch = process.env.TARGET_ARCH || process.arch
  const libc = (await isMusl()) ? 'musl' : undefined
  const assetPlatformArch = getAssetPlatformArch(
    process.platform,
    targetArch,
    libc,
  )
  const assetName = `lief-${assetPlatformArch}.tar.gz`

  logger.info(`Downloading lief ${tag} (${assetName})...`)

  // LIEF: outputPath is .../lief/linux-x64/libLIEF.a -> extract to .../lief/linux-x64/
  const downloadDir = path.dirname(outputPath)
  const downloadPath = path.join(downloadDir, assetName)

  try {
    // Download using Octokit (handles redirects automatically).
    await downloadReleaseAsset(tag, assetName, downloadPath)

    // Verify download.
    if (!existsSync(downloadPath)) {
      throw new Error(`Downloaded file not found at ${downloadPath}`)
    }

    logger.info(`Extracting ${assetName}...`)

    // Convert paths to forward slashes on Windows for tar compatibility.
    const tarResult = await spawn(
      'tar',
      ['-xzf', toTarPath(downloadPath), '-C', toTarPath(downloadDir)],
      { stdio: 'inherit' },
    )

    if (tarResult.code !== 0) {
      throw new Error(`tar extraction failed with exit code ${tarResult.code}`)
    }

    // Remove the archive.
    await safeDelete(downloadPath)

    // Write version file after extraction.
    const versionPath = path.join(downloadDir, '.version')
    await fs.writeFile(versionPath, tag, 'utf8')

    logger.success(`Extracted LIEF library to ${downloadDir}`)
    return true
  } catch (e) {
    // Clean up partial download if it exists.
    if (existsSync(downloadPath)) {
      try {
        safeDeleteSync(downloadPath)
      } catch {
        // Ignore cleanup errors.
      }
    }

    throw new Error(`Failed to download lief: ${e.message}`)
  }
}

/**
 * Download or build a tool.
 *
 * Environment variables:
 * - BUILD_TOOLS_FROM_SOURCE=true: Skip downloading binsuite tools (binpress/binflate/binject),
 *   require locally built versions. Used in Docker builds to test local changes.
 *   LIEF downloads are still allowed.
 * - BUILD_DEPS_FROM_SOURCE=true: Skip downloading LIEF,
 *   require it to be pre-installed on the system or built from source.
 * - BUILD_ALL_FROM_SOURCE=true: Shortcut for both BUILD_TOOLS_FROM_SOURCE and BUILD_DEPS_FROM_SOURCE.
 */
async function ensureTool(tool, force = false) {
  const isLief = tool === 'lief'
  const isBuildDep = isLief
  const isBinsuiteTool = !isBuildDep

  // Check if download is blocked by BUILD_*_FROM_SOURCE environment flags.
  if (isBinsuiteTool) {
    checkBuildSourceFlag(tool, 'TOOLS')
  }
  if (isBuildDep) {
    checkBuildSourceFlag(tool, 'DEPS', {
      buildCommand: 'Install system-wide or build from source',
    })
  }

  // All tools download to centralized location: packages/build-infra/build/downloaded/{tool}/{platform-arch}/
  // Support cross-compilation via TARGET_ARCH environment variable.
  const targetArch = process.env.TARGET_ARCH || process.arch
  const libc = (await isMusl()) ? 'musl' : undefined
  // Use getPlatformArch for directory paths (win32-x64), not getAssetPlatformArch (win-x64).
  const platformArch = getPlatformArch(process.platform, targetArch, libc)
  // Navigate from packages/bin-infra/scripts/ to packages/build-infra/
  const buildInfraDir = path.join(__dirname, '../../build-infra')
  const downloadDir = path.join(buildInfraDir, 'build', 'downloaded')

  // LIEF extracts to include/ and lib/ subdirectories.
  const binaryName = isLief
    ? 'libLIEF.a'
    : `${tool}${process.platform === 'win32' ? '.exe' : ''}`
  const binaryPath = path.join(downloadDir, tool, platformArch, binaryName)

  // Check if binary already exists and version matches.
  if (!force && existsSync(binaryPath)) {
    const versionPath = path.join(downloadDir, tool, platformArch, '.version')
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

  // Get latest release tag.
  const tag = await getLatestRelease(tool)
  if (!tag) {
    throw new Error(
      `Failed to get ${tool} release version. ` +
        'Check network connectivity and GitHub API availability.',
    )
  }

  // Download the tool.
  if (isLief) {
    // LIEF needs special archive handling.
    await downloadLief(tag, binaryPath)
  } else {
    // Use shared helper for binsuite tools.
    logger.info(`Downloading ${tool} ${tag}...`)

    await downloadSocketBtmRelease({
      bin: tool,
      cwd: buildInfraDir,
      downloadDir,
      libc: process.platform === 'linux' ? libc : undefined,
      removeMacOSQuarantine: true,
      tag,
      targetArch,
      targetPlatform: process.platform,
      tool,
    })

    const stats = await fs.stat(binaryPath)
    const sizeMB = (stats.size / 1024 / 1024).toFixed(2)
    logger.success(`Downloaded ${tool} (${sizeMB} MB)`)
  }

  return true
}

/**
 * Main entry point.
 */
async function main() {
  const args = process.argv.slice(2)
  const force = args.includes('--force')
  const toolArg = args.find(arg => arg.startsWith('--tool='))
  const toolFilter = toolArg ? toolArg.split('=')[1] || undefined : undefined

  const toolsToEnsure = toolFilter ? [toolFilter] : TOOLS

  // Validate tool names.
  for (const tool of toolsToEnsure) {
    if (!TOOLS.includes(tool)) {
      logger.fail(`Unknown tool: ${tool}`)
      logger.info(`Valid tools: ${TOOLS.join(', ')}`)
      process.exitCode = 1
      return
    }
  }

  logger.info('Ensuring binsuite tools are available...\n')

  const failedTools = []
  for (const tool of toolsToEnsure) {
    try {
      await ensureTool(tool, force)
    } catch (e) {
      logger.fail(`${tool}: ${e.message}`)
      failedTools.push(tool)
    }
    logger.info('')
  }

  if (failedTools.length === 0) {
    logger.success('All tools are ready')
  } else {
    logger.fail(`Failed to download: ${failedTools.join(', ')}`)
    process.exitCode = 1
  }
}

main().catch(e => {
  logger.fail(`Error: ${e.message}`)
  process.exitCode = 1
})
