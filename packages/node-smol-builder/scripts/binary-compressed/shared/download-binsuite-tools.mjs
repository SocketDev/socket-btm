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

import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

const logger = getDefaultLogger()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const REPO = 'SocketDev/socket-btm'
const TOOLS = ['binpress', 'binflate', 'binject', 'lief']

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
 * Get latest release tag for a tool.
 */
async function getLatestRelease(tool) {
  try {
    const result = await spawn(
      'gh',
      ['release', 'list', '--repo', REPO, '--limit', '100'],
      { stdio: 'pipe' },
    )

    if (result.code !== 0) {
      throw new Error(`gh release list failed: ${result.stderr}`)
    }

    // Parse gh release list output (tab-separated: title, type, tag, date).
    const lines = result.stdout.trim().split('\n')
    for (const line of lines) {
      const [, , tag] = line.split('\t')
      if (tag?.startsWith(`${tool}-`)) {
        return tag
      }
    }

    return null
  } catch (e) {
    logger.warn(`Failed to get latest release for ${tool}: ${e.message}`)
    return null
  }
}

/**
 * Download binary from GitHub release.
 */
async function downloadBinary(tool, tag, outputPath) {
  const platformArch = getPlatformArch()
  const isLief = tool === 'lief'

  // LIEF releases are tar.gz archives, binsuite tools are standalone binaries.
  const ext = isLief ? '.tar.gz' : process.platform === 'win32' ? '.exe' : ''
  const assetName = `${tool}-${platformArch}${ext}`

  logger.info(`Downloading ${tool} ${tag} (${assetName})...`)

  try {
    const downloadPath = isLief
      ? path.join(path.dirname(outputPath), assetName)
      : outputPath

    // Download using gh release download.
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
        '--output',
        downloadPath,
      ],
      { stdio: 'inherit' },
    )

    if (result.code !== 0) {
      throw new Error(
        `gh release download failed with exit code ${result.code}`,
      )
    }

    // Verify download.
    if (!existsSync(downloadPath)) {
      throw new Error(`Downloaded asset not found at ${downloadPath}`)
    }

    // For LIEF, extract the archive.
    if (isLief) {
      logger.info(`Extracting ${assetName}...`)
      const extractDir = path.dirname(outputPath)

      // Extract tar.gz.
      const tarResult = await spawn(
        'tar',
        ['-xzf', downloadPath, '-C', extractDir],
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

  // Fall back to building from source.
  logger.info(`Building ${tool} from source...`)
  try {
    const filterName = isLief ? 'bin-infra' : tool
    const result = await spawn(
      'pnpm',
      ['--filter', filterName, 'run', isLief ? 'build:lief' : 'build'],
      { stdio: 'inherit' },
    )

    if (result.code !== 0) {
      throw new Error(`Build failed with exit code ${result.code}`)
    }

    if (!existsSync(binaryPath)) {
      throw new Error(`Binary not found after build: ${binaryPath}`)
    }

    logger.success(`Built ${tool} from source`)
    return true
  } catch (e) {
    logger.fail(`Failed to build ${tool}: ${e.message}`)
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
