/**
 * Build script for libpq — download, verify, and resolve functions.
 *
 * Downloads prebuilt libpq from GitHub releases and verifies checksums.
 * Split from build.mts to keep each file under the 500-line soft cap.
 */

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { fileURLToPath } from 'node:url'

import { checkBuildSourceFlag } from 'build-infra/lib/build-env'
import {
  BUILD_STAGES,
  CHECKPOINTS,
  getPlatformBuildDir,
} from 'build-infra/lib/constants'
import { getCurrentPlatformArch } from 'build-infra/lib/platform-mappings'
import { verifyReleaseChecksum } from 'build-infra/lib/release-checksums/core'
import { extractTarball } from 'build-infra/lib/tarball-utils'
import { getSubmoduleVersion } from 'build-infra/lib/version-helpers'
import { errorMessage } from 'build-infra/lib/error-utils'

import { safeDelete, safeMkdir } from '@socketsecurity/lib-stable/fs/safe'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { downloadSocketBtmRelease } from '@socketsecurity/lib-stable/releases/socket-btm'

export const logger = getDefaultLogger()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export const packageRoot = path.join(__dirname, '..')
export const postgresUpstream = path.join(packageRoot, 'upstream', 'postgres')

export const CROSS_COMPILE = process.env['CROSS_COMPILE'] === '1'
export const TARGET_ARCH = process.env['TARGET_ARCH'] || process.arch

// GNU make's built-in implicit C compile rule references $(TARGET_ARCH)
// as a standard recipe variable (historically used for `-m64`-style
// flags). When TARGET_ARCH is set as an env var, make picks it up as
// a make variable and appends it to the gcc command line, where gcc
// interprets the raw value (e.g. `x64`) as a positional input file
// and fails with `error: x64: linker input file not found`.
//
// We've already captured the value above, so unset it before spawning
// any make/cmake/configure that descends into upstream Makefiles.
delete process.env['TARGET_ARCH']

/**
 * Get checkpoint chain for CI workflows.
 *
 * @returns {string[]} Checkpoint chain in reverse dependency order
 */
export function getCheckpointChain() {
  // libpq has no dependencies on other socket-btm packages
  return [CHECKPOINTS.FINALIZED]
}

/**
 * Get build directories for a given platform-arch.
 *
 * @param {string} platformArch - Platform-arch identifier.
 *
 * @returns {{ buildDir: string; libpqBuildDir: string }}
 */
// oxlint-disable-next-line socket/sort-source-methods -- build script is ordered as a top-down pipeline (download → extract → configure → build → install → smoke test); alphabetizing across pipeline phases would scatter the flow and break the checkpoint reading order.
export function getBuildDirs(platformArch) {
  const buildDir = getPlatformBuildDir(packageRoot, platformArch)
  const libpqBuildDir = path.join(buildDir, 'out', BUILD_STAGES.FINAL, 'libpq')
  return { buildDir, libpqBuildDir }
}

/**
 * Required libpq library files.
 */
const LIBPQ_REQUIRED_FILES = ['libpq.a']

/**
 * Check if libpq libraries exist at a given directory.
 *
 * @param {string} dir - Directory to check.
 *
 * @returns {boolean} True if all required files exist.
 */
export function libpqExistsAt(dir) {
  return LIBPQ_REQUIRED_FILES.every(file => existsSync(path.join(dir, file)))
}

/**
 * Verify libpq archive integrity using SHA256 checksum.
 * Downloads checksums.txt from the release dynamically using shared utility.
 *
 * @param {string} archivePath - Path to archive file.
 * @param {string} assetName - Asset name for checksum lookup.
 *
 * @returns {Promise<{
 *   valid: boolean
 *   expected?: string
 *   actual?: string
 *   skipped?: boolean
 * }>}
 */
export async function verifyArchiveChecksum(archivePath, assetName) {
  return verifyReleaseChecksum({
    assetName,
    filePath: archivePath,
    tempDir: path.join(packageRoot, 'build', 'temp'),
    tool: 'libpq',
  })
}

/**
 * Download libpq from GitHub releases to downloaded directory.
 *
 * @param {object} [options] - Download options.
 * @param {boolean} [options.force] - Force redownload even if cached.
 * @param {string} [options.platformArch] - Override platform-arch.
 *
 * @returns {Promise<string>} Path to downloaded libpq directory.
 */
// oxlint-disable-next-line socket/sort-source-methods -- build script is ordered as a top-down pipeline (download → extract → configure → build → install → smoke test); alphabetizing across pipeline phases would scatter the flow and break the checkpoint reading order.
export async function downloadLibpq(options = {}) {
  const { force = false, platformArch } = options
  const resolvedPlatformArch = platformArch ?? (await getCurrentPlatformArch())

  // Check if download is blocked by BUILD_DEPS_FROM_SOURCE environment flag.
  checkBuildSourceFlag('libpq', 'DEPS', {
    buildCommand: 'node scripts/repo/build.mts',
  })

  const targetDir = path.join(
    packageRoot,
    'build',
    'downloaded',
    'libpq',
    resolvedPlatformArch,
  )
  const versionFile = path.join(targetDir, '.version')
  const assetName = `libpq-${resolvedPlatformArch}.tar.gz`

  // Check if already downloaded (unless force).
  if (!force && existsSync(versionFile) && libpqExistsAt(targetDir)) {
    const cachedVersion = (await fs.readFile(versionFile, 'utf8')).trim()
    logger.info(
      `Using cached libpq ${cachedVersion} for ${resolvedPlatformArch}`,
    )
    return targetDir
  }

  logger.info(`Downloading libpq for ${resolvedPlatformArch}...`)

  // Create target directory.
  await safeMkdir(targetDir)

  // Download archive using socket-btm release helper.
  const downloadedArchive = await downloadSocketBtmRelease('libpq', {
    asset: assetName,
    downloadDir: targetDir,
  })

  // Extract archive to the same directory as the downloaded archive
  const extractDir = path.dirname(downloadedArchive)
  logger.info('Extracting libpq archive…')

  // Verify archive exists before extraction.
  if (!existsSync(downloadedArchive)) {
    throw new Error(
      `Downloaded archive not found at expected path: ${downloadedArchive}`,
    )
  }

  // Verify tarball integrity before extraction.
  // oxlint-disable-next-line socket/prefer-exists-sync -- multiple fs.stat() calls consume stats.size for downloaded-archive / built-library size reporting and minimum-size quick checks.
  const archiveStats = await fs.stat(downloadedArchive)
  logger.info(
    `Archive size: ${(archiveStats.size / 1024 / 1024).toFixed(2)} MB`,
  )

  // Check gzip magic bytes (0x1f 0x8b) to verify it's a valid gzip file.
  const gzipMagic = Buffer.alloc(2)
  const fd = await fs.open(downloadedArchive, 'r')
  try {
    await fd.read(gzipMagic, 0, 2, 0)
  } finally {
    await fd.close()
  }

  if (gzipMagic[0] !== 0x1f || gzipMagic[1] !== 0x8b) {
    await safeDelete(downloadedArchive)
    if (existsSync(versionFile)) {
      await safeDelete(versionFile)
    }
    throw new Error(
      'Downloaded archive is not a valid gzip file (missing magic bytes). ' +
        `File may be corrupted or truncated. Deleted ${downloadedArchive} to force re-download.`,
    )
  }

  // Verify SHA256 checksum to detect corrupt/truncated downloads.
  logger.info('Verifying archive checksum…')
  const checksumResult = await verifyArchiveChecksum(
    downloadedArchive,
    assetName,
  )
  if (!checksumResult.valid) {
    await safeDelete(downloadedArchive)
    if (existsSync(versionFile)) {
      await safeDelete(versionFile)
    }
    throw new Error(
      'Archive checksum mismatch - file is corrupted.\n' +
        `  Expected: ${checksumResult.expected}\n` +
        `  Actual:   ${checksumResult.actual}\n` +
        `Deleted ${downloadedArchive} to force re-download.`,
    )
  }
  // Only log checksum if it was actually verified (not skipped due to missing expected checksum).
  if (checksumResult.actual) {
    logger.info(
      `Checksum verified: ${checksumResult.actual.slice(0, 16)}...${checksumResult.actual.slice(-8)}`,
    )
  }

  // Clean extraction directory.
  const libpqIncludeDir = path.join(extractDir, 'include')
  if (existsSync(libpqIncludeDir)) {
    await safeDelete(libpqIncludeDir)
  }

  // Extract using cross-platform tarball utility.
  try {
    await extractTarball(downloadedArchive, extractDir, {
      createDir: false,
      stdio: 'inherit',
      validate: true,
    })
  } catch (e) {
    await safeDelete(downloadedArchive)
    if (existsSync(versionFile)) {
      await safeDelete(versionFile)
    }
    throw new Error(
      `Failed to extract libpq archive from ${downloadedArchive}: ${errorMessage(e)}. ` +
        'Deleted corrupted archive to allow re-download on next run.',
      { cause: e },
    )
  }

  // Verify expected files exist after extraction.
  for (let i = 0, { length } = LIBPQ_REQUIRED_FILES; i < length; i += 1) {
    const file = LIBPQ_REQUIRED_FILES[i]
    if (!existsSync(path.join(extractDir, file))) {
      throw new Error(`Expected file not found after extraction: ${file}`)
    }
  }

  // Write version file after cleanup.
  await fs.writeFile(versionFile, POSTGRES_VERSION, 'utf8')

  // oxlint-disable-next-line socket/prefer-exists-sync -- multiple fs.stat() calls consume stats.size for downloaded-archive / built-library size reporting and minimum-size quick checks.
  const stats = await fs.stat(path.join(extractDir, 'libpq.a'))
  const sizeMB = (stats.size / 1024 / 1024).toFixed(2)
  logger.success(`Downloaded libpq (${sizeMB} MB) to ${extractDir}`)

  return extractDir
}

/**
 * Ensure libpq libraries are available.
 * Checks local build first, then downloaded, then downloads if needed.
 *
 * @param {object} [options] - Options.
 * @param {boolean} [options.force] - Force redownload even if cached.
 * @param {string} [options.platformArch] - Override platform-arch.
 *
 * @returns {Promise<string>} Path to directory containing libpq libraries.
 */
// oxlint-disable-next-line socket/sort-source-methods -- build script is ordered as a top-down pipeline (download → extract → configure → build → install → smoke test); alphabetizing across pipeline phases would scatter the flow and break the checkpoint reading order.
export async function ensureLibpq(options = {}) {
  const { force = false, platformArch } = options
  const resolvedPlatformArch = platformArch ?? (await getCurrentPlatformArch())

  // 1. Check local build first (platform-specific directory).
  const { libpqBuildDir } = getBuildDirs(resolvedPlatformArch)
  const localDir = path.join(libpqBuildDir, 'dist')
  if (!force && libpqExistsAt(localDir)) {
    logger.info(`Using local libpq build at ${localDir}`)
    return localDir
  }

  // 2. Check downloaded version.
  const downloadedDir = path.join(
    packageRoot,
    'build',
    'downloaded',
    'libpq',
    resolvedPlatformArch,
  )
  if (!force && libpqExistsAt(downloadedDir)) {
    logger.info(`Using downloaded libpq at ${downloadedDir}`)
    return downloadedDir
  }

  // 3. Download libpq.
  logger.info('libpq not found locally, downloading…')
  return await downloadLibpq({ force, platformArch: resolvedPlatformArch })
}

// PostgreSQL version (extracted from .gitmodules comment).
export const POSTGRES_VERSION = getPostgresVersion()

/**
 * Extract PostgreSQL version from .gitmodules comment.
 *
 * @returns {string} PostgreSQL version (e.g., "16.6")
 */
// oxlint-disable-next-line socket/sort-source-methods -- build script is ordered as a top-down pipeline (download → extract → configure → build → install → smoke test); alphabetizing across pipeline phases would scatter the flow and break the checkpoint reading order.
export function getPostgresVersion() {
  try {
    const version = getSubmoduleVersion(
      'packages/libpq-builder/upstream/postgres',
      'postgres',
    )
    logger.info(`Detected PostgreSQL version from .gitmodules: ${version}`)
    return version
  } catch {
    // Submodule not yet added - return placeholder
    return '17.4'
  }
}
