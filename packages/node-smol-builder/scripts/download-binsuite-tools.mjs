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

import { checkBuildSourceFlag } from 'build-infra/lib/build-env'
import {
  getCurrentPlatformArch,
  getPlatformArch,
} from 'build-infra/lib/platform-mappings'

import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { downloadSocketBtmRelease } from '@socketsecurity/lib/releases/socket-btm'

const logger = getDefaultLogger()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PACKAGE_ROOT = path.join(__dirname, '..')

const TOOLS = ['binpress', 'binflate', 'binject']

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
  const { platformArch } = options
  const resolvedPlatformArch = platformArch ?? (await getCurrentPlatformArch())

  // Check if download is blocked by BUILD_TOOLS_FROM_SOURCE environment flag.
  checkBuildSourceFlag(tool, 'TOOLS')

  // Download to centralized location: packages/build-infra/build/downloaded/{tool}/{platform}-{arch}[-musl]/{tool}[.exe]
  const buildInfraDir = path.join(PACKAGE_ROOT, '..', 'build-infra')
  const downloadDir = path.join(buildInfraDir, 'build', 'downloaded')

  // Parse platform and arch from platformArch string.
  const parts = resolvedPlatformArch.split('-')
  if (parts.length < 2 || parts.length > 3) {
    throw new Error(
      `Invalid platform-arch format: "${resolvedPlatformArch}". ` +
        `Expected format: "platform-arch" or "platform-arch-libc" ` +
        `(e.g., "linux-x64" or "linux-x64-musl")`,
    )
  }
  const platform = parts[0]
  const arch = parts[1]
  // Validate libc component if present
  let libc
  if (parts[2]) {
    if (parts[2] !== 'musl' && parts[2] !== 'glibc') {
      throw new Error(
        `Invalid libc value in platform-arch: "${parts[2]}". ` +
          `Expected "musl" or "glibc"`,
      )
    }
    libc = parts[2] === 'musl' ? 'musl' : undefined
  }

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
    throw new Error(`Failed to download ${tool}: ${e.message}`)
  }
}

/**
 * Main entry point.
 */
async function main() {
  const args = process.argv.slice(2)
  const force = args.includes('--force')
  const toolArg = args.find(arg => arg.startsWith('--tool='))
  const toolFilter = toolArg ? toolArg.split('=')[1] || undefined : undefined
  const platformArg = args.find(arg => arg.startsWith('--platform='))
  const archArg = args.find(arg => arg.startsWith('--arch='))

  const toolsToDownload = toolFilter ? [toolFilter] : TOOLS

  // If --platform and --arch are specified, construct custom platformArch
  let customPlatformArch
  const libcArg = args.find(arg => arg.startsWith('--libc='))
  const libc = libcArg ? libcArg.split('=')[1] || undefined : undefined

  if (platformArg && archArg) {
    const platform = platformArg.split('=')[1] || ''
    const arch = archArg.split('=')[1] || ''

    if (!platform || !arch) {
      logger.fail(
        'Invalid format for --platform or --arch. Use: --platform=linux --arch=x64',
      )
      process.exitCode = 1
      return
    }

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

  const targetPlatformArch =
    customPlatformArch || (await getCurrentPlatformArch())

  logger.info('Downloading binsuite tools for node-smol-builder...')
  logger.info(`Platform: ${targetPlatformArch}`)
  logger.info('')

  const results = await Promise.allSettled(
    toolsToDownload.map(tool =>
      downloadTool(tool, { force, platformArch: targetPlatformArch }),
    ),
  )

  logger.info('')

  // Report any failures.
  const failures = results
    .map((r, i) => ({ result: r, tool: toolsToDownload[i] }))
    .filter(({ result }) => result.status === 'rejected')

  for (const { result, tool } of failures) {
    logger.fail(`${tool}: ${result.reason?.message || result.reason}`)
  }

  const successful = results.filter(r => r.status === 'fulfilled').length

  if (failures.length === 0) {
    logger.success(`All ${successful} tools downloaded successfully`)
  } else {
    logger.fail(`${failures.length} tool(s) failed to download`)
    process.exitCode = 1
  }
}

main().catch(e => {
  logger.fail(`Download failed: ${e.message}`)
  process.exitCode = 1
})
