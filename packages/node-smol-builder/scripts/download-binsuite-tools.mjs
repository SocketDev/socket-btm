#!/usr/bin/env node
/**
 * Download prebuilt binsuite tools for node-smol-builder.
 *
 * Downloads tools to: packages/node-smol-builder/build/{tool}/{platform}-{arch}[-musl]/{tool}[.exe]
 *
 * This keeps all build artifacts isolated within node-smol-builder's build directory,
 * separate from the tool packages (binpress, binflate, binject).
 */

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { ALPINE_RELEASE_FILE } from 'build-infra/lib/environment-constants'
import {
  downloadReleaseAsset,
  getLatestRelease,
} from 'build-infra/lib/github-releases'
import { getPlatformArch } from 'build-infra/lib/platform-mappings'

import { safeDelete } from '@socketsecurity/lib/fs'
import { getDefaultLogger } from '@socketsecurity/lib/logger'

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
  const libc = isMusl() ? 'musl' : null
  return getPlatformArch(process.platform, process.arch, libc)
}

/**
 * Download a tool from GitHub releases.
 * Follows socket-cli's pattern for version tracking and cache invalidation.
 *
 * @param {string} tool - Tool name (binpress, binflate, binject)
 * @param {object} options - Download options
 * @param {boolean} [options.force] - Force redownload even if cached
 * @param {string} [options.platformArch] - Override platform-arch (e.g., 'linux-x64-musl')
 */
async function downloadTool(tool, options = {}) {
  const { force = false, platformArch = getCurrentPlatformArch() } = options

  // Determine file extension based on platform in platformArch string
  const isWindows = platformArch.startsWith('win')
  const ext = isWindows ? '.exe' : ''
  const binaryName = `${tool}${ext}`

  // Download to: packages/node-smol-builder/build/{tool}/{platform}-{arch}[-musl]/{tool}[.exe]
  const toolDir = path.join(PACKAGE_ROOT, 'build', tool, platformArch)
  const binaryPath = path.join(toolDir, binaryName)
  const versionPath = path.join(toolDir, '.version')

  // Get latest release tag.
  const tag = await getLatestRelease(tool)
  if (!tag) {
    logger.fail(`No ${tool} release found`)
    return false
  }

  // Check if cached version matches requested version (store full tag for consistency).
  const cachedVersion = existsSync(versionPath)
    ? (await fs.readFile(versionPath, 'utf8')).trim()
    : null

  if (!force && cachedVersion === tag && existsSync(binaryPath)) {
    logger.success(`${tool} ${tag} already cached at ${binaryPath}`)
    return true
  }

  // Clear stale cache.
  if (existsSync(toolDir)) {
    logger.info(`Clearing stale ${tool} cache...`)
    await safeDelete(toolDir)
  }

  // Asset name: {tool}-{platform}-{arch}[-musl][.exe]
  const assetName = `${tool}-${platformArch}${ext}`

  logger.info(`Downloading ${tool} ${tag} (${assetName})...`)

  // Create output directory.
  await fs.mkdir(toolDir, { recursive: true })

  try {
    // Download using github-releases helper (handles HTTP 302 redirects automatically).
    await downloadReleaseAsset(tag, assetName, binaryPath)

    // Verify download.
    if (!existsSync(binaryPath)) {
      throw new Error(`Downloaded file not found at ${binaryPath}`)
    }

    // Make executable on Unix.
    if (process.platform !== 'win32') {
      await fs.chmod(binaryPath, 0o755)
    }

    // Write version file (store full tag for consistency).
    await fs.writeFile(versionPath, tag, 'utf8')

    const stats = await fs.stat(binaryPath)
    const sizeMB = (stats.size / 1024 / 1024).toFixed(2)
    logger.success(`Downloaded ${tool} ${tag} (${sizeMB} MB) to ${binaryPath}`)

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
  const toolFilter = toolArg ? toolArg.split('=')[1] : null
  const platformArg = args.find(arg => arg.startsWith('--platform='))
  const archArg = args.find(arg => arg.startsWith('--arch='))

  const toolsToDownload = toolFilter ? [toolFilter] : TOOLS

  // If --platform and --arch are specified, construct custom platformArch
  let customPlatformArch = null
  const libcArg = args.find(arg => arg.startsWith('--libc='))
  const libc = libcArg ? libcArg.split('=')[1] : null

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
        platform === 'linux' ? libc : null,
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

  const results = await Promise.all(
    toolsToDownload.map(tool =>
      downloadTool(tool, { force, platformArch: targetPlatformArch }),
    ),
  )

  logger.info('')
  const successful = results.filter(Boolean).length
  const failed = results.length - successful

  if (failed === 0) {
    logger.success(`All ${successful} tools downloaded successfully`)
  } else {
    logger.fail(`${failed} tool(s) failed to download`)
    process.exitCode = 1
  }
}

main().catch(e => {
  logger.fail(`Download failed: ${e.message}`)
  process.exitCode = 1
})
