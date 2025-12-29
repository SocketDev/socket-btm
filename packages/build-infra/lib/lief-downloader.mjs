/**
 * Shared utility for downloading LIEF library from releases.
 * Used by binject, binpress, and node-smol-builder.
 */

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'

import { BUILD_STAGES } from './constants.mjs'
import { getLatestRelease } from './github-releases.mjs'

import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

const logger = getDefaultLogger()

/**
 * Get the currently installed LIEF version.
 *
 * @param {string} liefDir - LIEF directory path.
 * @returns {Promise<string|null>} - Installed version or null if not found.
 */
async function getInstalledLiefVersion(liefDir) {
  const versionFile = path.join(liefDir, '.version')
  try {
    const version = await fs.readFile(versionFile, 'utf8')
    return version.trim()
  } catch {
    return null
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
 * @param {object} options - Download options.
 * @param {string} options.BUILD_MODE - Build mode ('dev' or 'prod').
 * @param {string} options.packageDir - Package directory path.
 * @param {string[]} [options.platforms] - Required platforms (defaults to current platform only).
 * @param {boolean} [options.force] - Force download even if already exists.
 * @returns {Promise<void>}
 */
export async function ensureLief({ BUILD_MODE, force, packageDir, platforms }) {
  const binInfraBuildDir = path.join(
    packageDir,
    '../bin-infra/build',
    BUILD_MODE,
  )
  const liefDir = path.join(binInfraBuildDir, 'out', BUILD_STAGES.FINAL, 'lief')

  // Check for platform-specific library files.
  const platformsToCheck = platforms || [process.platform]
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

  if (!force && liefExists) {
    // Check for newer version.
    const [installedVersion, latestVersion] = await Promise.all([
      getInstalledLiefVersion(liefDir),
      getLatestRelease('lief', { quiet: true }),
    ])

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
    throw new Error(
      `Failed to download LIEF library (exit code ${result.code}). ` +
        'LIEF must be available in socket-btm releases.',
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
    throw new Error(
      `LIEF library download completed but files are missing: ${stillMissing.join(', ')}`,
    )
  }

  logger.success(
    `LIEF library downloaded successfully (${downloadedVersion || 'unknown'})`,
  )
}
