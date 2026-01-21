#!/usr/bin/env node
/**
 * Download prebuilt binsuite tools for node-smol-builder.
 *
 * Downloads tools to: packages/build-infra/build/downloaded/{tool}/{platform}-{arch}[-musl]/{tool}[.exe]
 *
 * This uses the centralized download location shared across all packages.
 */

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { envIsTrue } from 'build-infra/lib/build-env'
import { ALPINE_RELEASE_FILE } from 'build-infra/lib/constants'
import { getPlatformArch } from 'build-infra/lib/platform-mappings'

import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { downloadSocketBtmRelease } from '@socketsecurity/lib/releases/socket-btm'

const logger = getDefaultLogger()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PACKAGE_ROOT = path.join(__dirname, '..')

const TOOLS = ['binpress', 'binflate', 'binject']

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
 * Download a tool from GitHub releases.
 * Follows socket-cli's pattern for version tracking and cache invalidation.
 *
 * Environment variables:
 * - BUILD_TOOLS_FROM_SOURCE=true: Skip downloading binsuite tools (binpress/binflate/binject),
 *   require locally built versions. Used in Docker builds to test local changes.
 * - BUILD_ALL_FROM_SOURCE=true: Shortcut for both BUILD_TOOLS_FROM_SOURCE and BUILD_DEPS_FROM_SOURCE.
 *
 * @param {string} tool - Tool name (binpress, binflate, binject)
 * @param {object} options - Download options
 * @param {boolean} [options.force] - Force redownload even if cached
 * @param {string} [options.platformArch] - Override platform-arch (e.g., 'linux-x64-musl')
 */
async function downloadTool(tool, options = {}) {
  const { platformArch = getCurrentPlatformArch() } = options
  const buildAllFromSource = envIsTrue(process.env.BUILD_ALL_FROM_SOURCE)
  const buildToolsFromSource =
    buildAllFromSource || envIsTrue(process.env.BUILD_TOOLS_FROM_SOURCE)

  // Check if download is blocked by environment
  if (buildToolsFromSource) {
    throw new Error(
      `${tool} download blocked by BUILD_TOOLS_FROM_SOURCE=true.\n` +
        `Build ${tool} locally first:\n` +
        `  pnpm --filter ${tool} build\n` +
        'Or unset BUILD_TOOLS_FROM_SOURCE to allow downloading from releases.',
    )
  }

  // Download to centralized location: packages/build-infra/build/downloaded/{tool}/{platform}-{arch}[-musl]/{tool}[.exe]
  const buildInfraDir = path.join(PACKAGE_ROOT, '..', 'build-infra')
  const downloadDir = path.join(buildInfraDir, 'build', 'downloaded')

  // Parse platform and arch from platformArch string
  const parts = platformArch.split('-')
  const platform = parts[0]
  const arch = parts[1]
  const libc = parts[2] === 'musl' ? 'musl' : undefined

  try {
    logger.info(`Downloading ${tool}...`)

    // Download using socket-btm release helper.
    const binaryPath = await downloadSocketBtmRelease({
      bin: tool,
      cwd: buildInfraDir,
      downloadDir,
      libc: platform === 'linux' ? libc : undefined,
      removeMacOSQuarantine: true,
      targetArch: arch,
      targetPlatform: platform,
      tool,
    })

    // Verify download.
    if (!existsSync(binaryPath)) {
      throw new Error(`Downloaded file not found at ${binaryPath}`)
    }

    const stats = await fs.stat(binaryPath)
    const sizeMB = (stats.size / 1024 / 1024).toFixed(2)
    logger.success(`Downloaded ${tool} (${sizeMB} MB) to ${binaryPath}`)

    return true
  } catch (e) {
    logger.fail(`Failed to download ${tool}: ${e.message}`)
    return false
  }
}

/**
 * Main entry point.
 */
async function main() {
  const args = process.argv.slice(2)
  const force = args.includes('--force')
  const toolArg = args.find(arg => arg.startsWith('--tool='))
  const toolFilter = toolArg ? toolArg.split('=')[1] : undefined
  const platformArg = args.find(arg => arg.startsWith('--platform='))
  const archArg = args.find(arg => arg.startsWith('--arch='))

  const toolsToDownload = toolFilter ? [toolFilter] : TOOLS

  // If --platform and --arch are specified, construct custom platformArch
  let customPlatformArch
  const libcArg = args.find(arg => arg.startsWith('--libc='))
  const libc = libcArg ? libcArg.split('=')[1] : undefined

  if (platformArg && archArg) {
    const platform = platformArg.split('=')[1]
    const arch = archArg.split('=')[1]

    // Validate libc
    if (libc && libc !== 'musl' && libc !== 'glibc') {
      logger.fail(`Invalid --libc value: ${libc}. Valid options: musl, glibc`)
      process.exitCode = 1
      return
    }
    if (libc && platform !== 'linux') {
      logger.fail(
        `--libc parameter is only valid for Linux platform (got platform: ${platform})`,
      )
      process.exitCode = 1
      return
    }

    // Use shared platform mapping for custom platform-arch.
    try {
      customPlatformArch = getPlatformArch(
        platform,
        arch,
        platform === 'linux' ? libc : undefined,
      )
    } catch (e) {
      logger.fail(e.message)
      process.exitCode = 1
      return
    }
  }

  const targetPlatformArch = customPlatformArch || getCurrentPlatformArch()

  logger.info('Downloading binsuite tools for node-smol-builder...')
  logger.info(`Platform: ${targetPlatformArch}`)
  logger.info('')

  const results = await Promise.allSettled(
    toolsToDownload.map(tool =>
      downloadTool(tool, { force, platformArch: targetPlatformArch }),
    ),
  )

  logger.info('')
  const successful = results.filter(
    r => r.status === 'fulfilled' && r.value,
  ).length
  const failed = results.length - successful

  if (failed === 0) {
    logger.success(`All ${successful} tools downloaded successfully`)
  } else {
    logger.fail(`${failed} tool(s) failed to download`)
    process.exit(1)
  }
}

main().catch(e => {
  logger.fail(`Download failed: ${e.message}`)
  process.exit(1)
})
