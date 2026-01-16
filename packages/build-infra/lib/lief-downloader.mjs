/**
 * Shared utility for downloading LIEF library from releases.
 * Used by binject, binpress, and node-smol-builder.
 */

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'

import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

import { envIsTrue, getPlatform } from './build-env.mjs'
import { ALPINE_RELEASE_FILE } from './constants.mjs'
import { getLatestRelease } from './github-releases.mjs'
import { getPlatformArch } from './platform-mappings.mjs'

const logger = getDefaultLogger()

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
 * Get the currently installed LIEF version.
 *
 * @param {string} liefDir - LIEF directory path.
 * @returns {Promise<string|undefined>} - Installed version or undefined if not found.
 */
async function getInstalledLiefVersion(liefDir) {
  const versionFile = path.join(liefDir, '.version')
  try {
    const version = await fs.readFile(versionFile, 'utf8')
    return version.trim()
  } catch {
    return undefined
  }
}

/**
 * Save the LIEF version to a version file.
 *
 * @param {string} liefDir - LIEF directory path.
 * @param {string} version - Version tag to save.
 */
async function saveInstalledLiefVersion(liefDir, version) {
  const versionFile = path.join(liefDir, '.version')
  try {
    await fs.writeFile(versionFile, version, 'utf8')
  } catch (e) {
    logger.warn(`Could not save LIEF version: ${e.message}`)
  }
}

/**
 * Ensure LIEF library exists by downloading from releases if needed.
 * Checks for newer versions and downloads if available.
 *
 * Environment variables:
 * - BUILD_DEPS_FROM_SOURCE=true: Skip downloading LIEF, require pre-installed system LIEF.
 * - BUILD_ALL_FROM_SOURCE=true: Shortcut for both BUILD_TOOLS_FROM_SOURCE and BUILD_DEPS_FROM_SOURCE.
 *
 * @param {object} options - Download options.
 * @param {string} options.BUILD_MODE - Build mode ('dev' or 'prod').
 * @param {string} options.packageDir - Package directory path.
 * @param {string[]} [options.platforms] - Required platforms (defaults to current platform only).
 * @param {boolean} [options.force] - Force download even if already exists.
 * @returns {Promise<void>}
 */
export async function ensureLief({
  BUILD_MODE: _BUILD_MODE,
  force,
  packageDir,
  platforms,
}) {
  const buildAllFromSource = envIsTrue(process.env.BUILD_ALL_FROM_SOURCE)
  const buildDepsFromSource =
    buildAllFromSource || envIsTrue(process.env.BUILD_DEPS_FROM_SOURCE)
  // LIEF downloads to centralized location: packages/build-infra/build/downloaded/lief/{platform-arch}/
  // This is separate from the build output directory (build/{mode}/out/Final/lief).

  // Determine platform-arch using consistent naming.
  const libc = isMusl() ? 'musl' : undefined
  // Use first platform if multiple specified
  const platformArch = platforms
    ? getPlatformArch(platforms[0], process.arch, libc)
    : getPlatformArch(process.platform, process.arch, libc)

  const buildInfraDir = path.join(packageDir, '../build-infra')
  const liefDir = path.join(
    buildInfraDir,
    'build',
    'downloaded',
    'lief',
    platformArch,
  )

  // Check for platform-specific library files.
  const platformsToCheck = platforms || [getPlatform()]
  const requiredPaths = []

  for (const platform of platformsToCheck) {
    if (platform === 'darwin' || platform === 'linux') {
      requiredPaths.push(path.join(liefDir, 'libLIEF.a'))
    } else if (platform === 'win32') {
      // Windows can have either libLIEF.a (gcc) or LIEF.lib (clang).
      const libPathGcc = path.join(liefDir, 'libLIEF.a')
      const libPathMsvc = path.join(liefDir, 'LIEF.lib')
      // Consider Windows satisfied if either exists.
      if (!existsSync(libPathGcc) && !existsSync(libPathMsvc)) {
        requiredPaths.push(libPathGcc)
      }
    }
  }

  // Also check for include directory.
  const liefIncludeDir = path.join(liefDir, 'include')
  requiredPaths.push(liefIncludeDir)

  // Check if all required paths exist.
  const missingPaths = requiredPaths.filter(p => !existsSync(p))
  const liefExists = missingPaths.length === 0

  // If BUILD_DEPS_FROM_SOURCE is set and LIEF doesn't exist, error out
  if (buildDepsFromSource && !liefExists) {
    throw new Error(
      'LIEF library not found and BUILD_DEPS_FROM_SOURCE=true.\n' +
        `Expected: ${requiredPaths.join(', ')}\n` +
        'Either install LIEF system-wide or unset BUILD_DEPS_FROM_SOURCE to allow downloading.',
    )
  }

  if (!force && liefExists) {
    // Check for newer version.
    const results = await Promise.allSettled([
      getInstalledLiefVersion(liefDir),
      getLatestRelease('lief', { quiet: true }),
    ])

    const installedVersion =
      results[0].status === 'fulfilled' ? results[0].value : undefined
    const latestVersion =
      results[1].status === 'fulfilled' ? results[1].value : undefined

    if (latestVersion && installedVersion !== latestVersion) {
      logger.info(
        `LIEF update available: ${installedVersion || 'unknown'} → ${latestVersion}`,
      )
      logger.info('Downloading newer LIEF version...')
    } else {
      logger.success(`LIEF library found (${installedVersion || 'unknown'})`)
      return
    }
  } else if (liefExists && force) {
    logger.info('Force downloading LIEF library...')
  } else {
    logger.info('Downloading LIEF library from releases...')
  }

  // Download LIEF from releases.
  const downloadScript = path.join(
    packageDir,
    '../bin-infra/scripts/download-binsuite-tools.mjs',
  )

  const args = ['--tool=lief']
  if (force) {
    args.push('--force')
  }

  const result = await spawn('node', [downloadScript, ...args], {
    stdio: 'inherit',
  })

  if (result.code !== 0) {
    logger.error(`Failed to download LIEF library (exit code ${result.code}).`)
    // Clean up any stale LIEF files from cache to prevent build errors.
    try {
      const { safeDeleteSync } = await import('@socketsecurity/lib/fs')
      if (existsSync(liefDir)) {
        safeDeleteSync(liefDir)
        logger.info('Removed stale LIEF cache files')
      }
    } catch {
      // Ignore cleanup errors.
    }
    throw new Error(
      'LIEF library is required for cross-platform binary injection. ' +
        'Please ensure LIEF releases are available or build LIEF first.',
    )
  }

  // Get the downloaded version and save it.
  const downloadedVersion = await getLatestRelease('lief', { quiet: true })
  if (downloadedVersion) {
    await saveInstalledLiefVersion(liefDir, downloadedVersion)
  }

  // Verify download succeeded.
  const stillMissing = requiredPaths.filter(p => !existsSync(p))
  if (stillMissing.length > 0) {
    // Debug: List what files are actually present.
    logger.error('LIEF extraction completed but expected files are missing.')
    logger.info(`Expected paths: ${requiredPaths.join(', ')}`)
    try {
      const { readdirSync } = await import('node:fs')
      logger.info(
        `Files in ${liefDir}: ${readdirSync(liefDir, { withFileTypes: true })
          .map(d => d.name)
          .join(', ')}`,
      )
    } catch {
      logger.warn(`Could not list contents of ${liefDir}`)
    }
    throw new Error(
      `LIEF library download completed but files are missing: ${stillMissing.join(', ')}`,
    )
  }

  logger.success(
    `LIEF library downloaded successfully (${downloadedVersion || 'unknown'})`,
  )
}
