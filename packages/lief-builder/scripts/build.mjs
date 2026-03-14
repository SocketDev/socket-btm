/**
 * Build script for LIEF library.
 * Downloads prebuilt LIEF from GitHub releases or builds from source.
 */

import { existsSync, promises as fs, readdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { checkBuildSourceFlag } from 'build-infra/lib/build-env'
import { createCheckpoint, shouldRun } from 'build-infra/lib/checkpoint-manager'
import {
  BUILD_STAGES,
  CHECKPOINTS,
  getBuildMode,
  getPlatformBuildDir,
} from 'build-infra/lib/constants'
import { logTransientErrorHelp } from 'build-infra/lib/github-error-utils'
import { getAssetPlatformArch, isMusl } from 'build-infra/lib/platform-mappings'
import { verifyReleaseChecksum } from 'build-infra/lib/release-checksums'
import { extractTarball } from 'build-infra/lib/tarball-utils'
import { getSubmoduleVersion } from 'build-infra/lib/version-helpers'

import { which } from '@socketsecurity/lib/bin'
import { WIN32 } from '@socketsecurity/lib/constants/platform'
import { safeDelete, safeMkdir } from '@socketsecurity/lib/fs'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import {
  detectLibc,
  downloadSocketBtmRelease,
} from '@socketsecurity/lib/releases/socket-btm'
import { spawn } from '@socketsecurity/lib/spawn'

const logger = getDefaultLogger()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const packageRoot = path.join(__dirname, '..')

const liefUpstream = path.join(packageRoot, 'upstream/lief')
const liefPatchedDir = path.join(
  packageRoot,
  'build',
  'shared',
  'source',
  'lief',
)

/**
 * Get build directories for a given platform-arch.
 *
 * @param {string} platformArch - Platform-arch identifier.
 * @returns {{ buildDir: string, liefBuildDir: string }}
 */
function getLiefBuildDirs(platformArch) {
  const buildDir = getPlatformBuildDir(packageRoot, platformArch)
  const liefBuildDir = path.join(buildDir, 'out', BUILD_STAGES.FINAL, 'lief')
  return { buildDir, liefBuildDir }
}

/**
 * Get current platform-arch for LIEF.
 * LIEF releases use 'win' not 'win32' for Windows platforms.
 *
 * @returns {string} Platform-arch identifier.
 */
function getCurrentLiefPlatformArch() {
  const libc = detectLibc()
  // Respect TARGET_ARCH for cross-compilation (set by workflows/Makefiles)
  const arch = process.env.TARGET_ARCH || process.arch
  // Use asset platform naming (win instead of win32).
  return getAssetPlatformArch(process.platform, arch, libc)
}

/**
 * Get the downloaded LIEF directory path.
 * downloadSocketBtmRelease with tool:'lief' creates {downloadDir}/lief/assets/ structure
 *
 * @param {string} platformArch - Platform-arch identifier.
 * @returns {string} Path to downloaded LIEF directory.
 */
function getDownloadedLiefDir(platformArch) {
  return path.join(
    packageRoot,
    'build',
    'downloaded',
    'lief',
    platformArch,
    'lief',
    'assets',
  )
}

/**
 * Verify LIEF archive integrity using SHA256 checksum.
 * Downloads checksums.txt from the release dynamically using shared utility.
 *
 * @param {string} archivePath - Path to archive file.
 * @param {string} assetName - Asset name for checksum lookup.
 * @returns {Promise<{valid: boolean, expected?: string, actual?: string, skipped?: boolean}>}
 */
async function verifyArchiveChecksum(archivePath, assetName) {
  return verifyReleaseChecksum({
    assetName,
    filePath: archivePath,
    tempDir: path.join(packageRoot, 'build', 'temp'),
    tool: 'lief',
  })
}

/**
 * Get required LIEF files for validation.
 * Returns file requirements where library can be either naming convention:
 * - MSVC on Windows: LIEF.lib
 * - MinGW/llvm-mingw on Windows: libLIEF.a
 * - Unix (macOS, Linux): libLIEF.a
 *
 * @returns {Array<string|string[]>} Array of required files. Arrays indicate alternatives (any one must exist).
 */
function getLiefRequiredFiles() {
  return [
    ['libLIEF.a', 'LIEF.lib'], // Either library naming convention
    'include/LIEF/LIEF.hpp',
    'include/LIEF/config.h',
  ]
}

/**
 * Verify all required LIEF files exist at a directory.
 *
 * @param {string} dir - Directory to check.
 * @returns {{valid: boolean, missing: string[]}} Validation result with list of missing files.
 */
export function verifyLiefAt(dir) {
  const requiredFiles = getLiefRequiredFiles()
  const missing = requiredFiles.filter(requirement => {
    // Array means alternatives - any one must exist
    if (Array.isArray(requirement)) {
      return !requirement.some(alt => existsSync(path.join(dir, alt)))
    }
    return !existsSync(path.join(dir, requirement))
  }).map(req => (Array.isArray(req) ? `{${req.join(',')}}` : req))
  return {
    valid: missing.length === 0,
    missing,
  }
}

/**
 * Check if LIEF installation is complete at a given directory.
 * Validates library file AND all required headers exist.
 *
 * @param {string} dir - Directory to check.
 * @returns {boolean} True if complete LIEF installation exists.
 */
export function liefExistsAt(dir) {
  return verifyLiefAt(dir).valid
}

/**
 * Get the LIEF library path at a specific directory (platform-specific).
 *
 * @param {string} dir - Directory to check.
 * @returns {string|undefined} Path to LIEF library if exists, undefined otherwise.
 */
function getLiefLibPathAt(dir) {
  const unixPath = path.join(dir, 'libLIEF.a')
  const msvcPath = path.join(dir, 'LIEF.lib')

  if (existsSync(unixPath)) {
    return unixPath
  }
  if (existsSync(msvcPath)) {
    return msvcPath
  }
  return undefined
}

/**
 * Get the LIEF library path (platform-specific).
 *
 * @param {string} [platformArch] - Platform-arch identifier. Defaults to current platform.
 * @returns {string|undefined} Path to LIEF library if exists, undefined otherwise.
 */
export function getLiefLibPath(platformArch) {
  const resolvedPlatformArch = platformArch ?? getCurrentLiefPlatformArch()
  const { liefBuildDir } = getLiefBuildDirs(resolvedPlatformArch)
  return getLiefLibPathAt(liefBuildDir)
}

/**
 * Check if LIEF library exists.
 *
 * @param {string} [platformArch] - Platform-arch identifier. Defaults to current platform.
 * @returns {boolean} True if LIEF library exists.
 */
export function liefExists(platformArch) {
  return getLiefLibPath(platformArch) !== undefined
}

/**
 * Extract LIEF version from .gitmodules comment.
 * The version is specified in the comment above the LIEF submodule entry.
 * @returns {string} LIEF version (e.g., "0.17.0")
 */
function getLiefVersion() {
  const version = getSubmoduleVersion(
    'packages/lief-builder/upstream/lief',
    'lief',
  )
  logger.info(`Detected LIEF version from .gitmodules: ${version}`)
  return version
}

// LIEF version (extracted from .gitmodules comment).
const LIEF_VERSION = getLiefVersion()

async function runCommand(command, args, cwd, env = {}) {
  logger.info(`Running: ${command} ${args.join(' ')}`)

  // Merge env properly, filtering out undefined values.
  const mergedEnv = { ...process.env }
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) {
      delete mergedEnv[key]
    } else {
      mergedEnv[key] = value
    }
  }

  const result = await spawn(command, args, {
    cwd,
    env: mergedEnv,
    stdio: 'inherit',
  })

  if (result.error) {
    throw new Error(`Command failed to spawn: ${result.error.message}`)
  }

  if (result.signal) {
    throw new Error(`Command terminated by signal: ${result.signal}`)
  }

  if (result.code !== 0) {
    throw new Error(`Command failed with exit code ${result.code}`)
  }
}

/**
 * Verify that a prebuilt LIEF library is compatible with musl libc.
 * Checks for glibc-specific fortify symbols that would cause linker errors.
 * @param {string} libPath - Path to libLIEF.a
 * @returns {Promise<{compatible: boolean, reason?: string}>}
 */
async function verifyMuslCompatibility(libPath) {
  if (!(await isMusl())) {
    return { compatible: true }
  }

  logger.info('Verifying LIEF library for musl compatibility...')

  try {
    // Use nm to check for glibc-specific fortify symbols.
    // These symbols (__memcpy_chk, __printf_chk, etc.) don't exist in musl.

    // First check if nm is available.
    try {
      await spawn('which', ['nm'], { stdio: 'pipe' })
    } catch {
      logger.info('Warning: nm not found, cannot verify musl compatibility')
      return { compatible: true }
    }

    // Run nm and capture output.
    let nmOutput
    try {
      const result = await spawn('nm', [libPath], { stdio: 'pipe' })
      nmOutput = result?.stdout
    } catch (nmError) {
      logger.info(
        `Warning: nm failed on ${libPath}: ${nmError?.message || 'Unknown error'}`,
      )
      return { compatible: true }
    }

    // Guard against missing stdout
    if (!nmOutput) {
      logger.info('Warning: nm returned empty output')
      return { compatible: true }
    }

    // Check for common glibc fortify symbols.
    const glibcSymbols = [
      '__memcpy_chk',
      '__memmove_chk',
      '__memset_chk',
      '__strcpy_chk',
      '__strncpy_chk',
      '__strcat_chk',
      '__strncat_chk',
      '__sprintf_chk',
      '__snprintf_chk',
      '__printf_chk',
      '__fprintf_chk',
      '__vprintf_chk',
      '__vfprintf_chk',
      '__vsprintf_chk',
      '__vsnprintf_chk',
    ]

    const foundSymbols = glibcSymbols.filter(sym => nmOutput.includes(sym))

    if (foundSymbols.length > 0) {
      logger.info(`Found ${foundSymbols.length} glibc fortify symbol(s)`)
      return {
        compatible: false,
        reason: `Library contains glibc-specific fortify symbols: ${foundSymbols.join(', ')}`,
      }
    }

    logger.info('No glibc fortify symbols found - library is musl-compatible')
    return { compatible: true }
  } catch (error) {
    // If we can't check, warn but don't fail.
    logger.info(
      `Warning: Could not verify musl compatibility: ${error.message}`,
    )
    return { compatible: true }
  }
}

/**
 * Copy LIEF source from upstream to build directory.
 * This allows patching without modifying the git submodule.
 * @param {string} sourceDir - Destination directory for copied source
 */
async function copyLiefSource(sourceDir) {
  // Check if LIEF upstream exists
  if (!existsSync(liefUpstream)) {
    throw new Error(
      `LIEF upstream not found at ${liefUpstream}. Run 'git submodule update --init --recursive' first.`,
    )
  }

  // Remove existing source directory if it exists
  if (existsSync(sourceDir)) {
    await safeDelete(sourceDir)
  }

  // Create parent directory
  await safeMkdir(path.dirname(sourceDir))

  // Copy source (excluding .git directory)
  logger.info('Copying LIEF source to build directory...')
  if (WIN32) {
    // Windows: use robocopy
    // robocopy exit codes: 0=no change, 1=files copied, 2-7=other success states, 8+=errors
    logger.info('Running: robocopy (copying LIEF source)')
    let result
    try {
      result = await spawn(
        'robocopy',
        [
          liefUpstream,
          sourceDir,
          '/E',
          '/XD',
          '.git',
          '/NFL',
          '/NDL',
          '/NJH',
          '/NJS',
        ],
        {
          cwd: packageRoot,
          stdio: 'inherit',
        },
      )
    } catch (error) {
      // spawn throws on non-zero exit codes, but robocopy uses 1-7 for success
      if (error?.code >= 8) {
        throw new Error(
          `robocopy failed with exit code ${error.code} (indicates error)`,
        )
      }
      // Exit codes 1-7 are success, continue
      result = error
    }

    if (result.error) {
      throw new Error(`robocopy failed to spawn: ${result.error.message}`)
    }

    if (result.signal) {
      throw new Error(`robocopy terminated by signal: ${result.signal}`)
    }

    // Verify copy succeeded
    if (!existsSync(sourceDir)) {
      throw new Error('robocopy completed but source directory is missing')
    }

    try {
      if (readdirSync(sourceDir).length === 0) {
        throw new Error('robocopy completed but source directory is empty')
      }
    } catch (error) {
      if (error?.code === 'EACCES' || error?.code === 'EPERM') {
        throw new Error(
          `robocopy completed but cannot read source directory: ${error?.message || 'Unknown error'}`,
        )
      }
      throw error
    }

    logger.info(`robocopy completed with exit code ${result.code} (success)`)
  } else {
    // Unix: use rsync or cp
    try {
      await runCommand(
        'rsync',
        ['-a', '--exclude=.git', `${liefUpstream}/`, sourceDir],
        packageRoot,
      )
    } catch {
      // Fallback to cp if rsync not available
      await runCommand('cp', ['-r', liefUpstream, sourceDir], packageRoot)
      // Remove .git if it was copied
      const gitDir = path.join(sourceDir, '.git')
      if (existsSync(gitDir)) {
        await safeDelete(gitDir)
      }
    }
  }

  logger.success('LIEF source copied')
}

/**
 * Apply Socket patches to LIEF source.
 * Patches are applied in order from patches/lief/*.patch
 * Uses `patch -p1` command (doesn't require git).
 * @param {string} sourceDir - Path to LIEF source directory
 */
async function applyLiefPatches(sourceDir) {
  const patchesDir = path.join(packageRoot, 'patches', 'lief')

  if (!existsSync(patchesDir)) {
    logger.info('No LIEF patches directory found, skipping patch application')
    return
  }

  const patches = readdirSync(patchesDir)
    .filter(f => f.endsWith('.patch'))
    .toSorted()

  if (patches.length === 0) {
    logger.info('No LIEF patches found')
    return
  }

  logger.info(`Applying ${patches.length} LIEF patch(es)...`)

  for (const patchFile of patches) {
    const patchPath = path.join(patchesDir, patchFile)
    logger.info(`  Applying ${patchFile}...`)

    try {
      // Check if patch is already applied (--dry-run with -R checks reverse)
      const checkResult = await spawn(
        'patch',
        ['-p1', '--dry-run', '-R', '-i', patchPath],
        { cwd: sourceDir, stdio: 'pipe' },
      )
      if (checkResult.code === 0) {
        logger.info('    Already applied, skipping')
        continue
      }
    } catch {
      // Patch not applied, continue to apply it
    }

    try {
      // Apply the patch using patch -p1 (doesn't require git)
      await runCommand('patch', ['-p1', '-i', patchPath], sourceDir)
      logger.info('    Applied successfully')
    } catch (error) {
      throw new Error(`Failed to apply patch ${patchFile}: ${error.message}`, {
        cause: error,
      })
    }
  }

  logger.success('All LIEF patches applied')
}

/**
 * Download prebuilt LIEF from GitHub releases.
 *
 * @param {object} [options] - Download options.
 * @param {string} [options.platformArch] - Override platform-arch.
 * @returns {Promise<string|null>} Path to downloaded LIEF directory, or null on failure.
 */
async function downloadPrebuiltLIEF(options = {}) {
  // Check if download is blocked by BUILD_DEPS_FROM_SOURCE environment flag.
  checkBuildSourceFlag('LIEF', 'DEPS', {
    buildCommand: 'Install LIEF system-wide or build from source',
  })

  const { platformArch } = options
  const resolvedPlatformArch = platformArch ?? getCurrentLiefPlatformArch()

  try {
    logger.info('Checking for prebuilt LIEF releases...')

    const assetName = `lief-${resolvedPlatformArch}.tar.gz`
    const targetDir = path.join(
      packageRoot,
      'build',
      'downloaded',
      'lief',
      resolvedPlatformArch,
    )

    // Create download directory.
    await safeMkdir(targetDir)

    // Download archive using socket-btm release helper.
    logger.info(`Downloading ${assetName}...`)

    const downloadedArchive = await downloadSocketBtmRelease({
      asset: assetName,
      downloadDir: targetDir,
      output: assetName,
      tool: 'lief',
    })

    // Extract archive to the same directory as the downloaded archive
    const extractDir = path.dirname(downloadedArchive)
    logger.info('Extracting LIEF archive...')

    // Verify archive exists before extraction.
    if (!existsSync(downloadedArchive)) {
      throw new Error(
        `Downloaded archive not found at expected path: ${downloadedArchive}`,
      )
    }

    // Verify tarball integrity before extraction (detect corrupted/truncated downloads).
    // This catches issues where a previous download was cached but is corrupt.
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
      // Delete corrupted archive and version file so next run will re-download.
      const versionFile = path.join(extractDir, '.version')
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
    // This catches issues where size/magic bytes pass but content is corrupted.
    logger.info('Verifying archive checksum...')
    const checksumResult = await verifyArchiveChecksum(
      downloadedArchive,
      assetName,
    )
    if (!checksumResult.valid) {
      const versionFile = path.join(extractDir, '.version')
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

    // Verify file size matches expected before extraction.
    // This catches incomplete downloads that might have correct partial checksums.
    // TODO: Fetch expected sizes from release metadata instead of hardcoding.
    // Sizes removed - will be updated after next LIEF release with LTO enabled.
    const EXPECTED_SIZES = {
      __proto__: null,
    }
    const expectedSize = EXPECTED_SIZES[assetName]
    if (expectedSize && archiveStats.size !== expectedSize) {
      const versionFile = path.join(extractDir, '.version')
      await safeDelete(downloadedArchive)
      if (existsSync(versionFile)) {
        await safeDelete(versionFile)
      }
      throw new Error(
        'Archive size mismatch - file may be incomplete.\n' +
          `  Expected: ${expectedSize} bytes\n` +
          `  Actual:   ${archiveStats.size} bytes\n` +
          `Deleted ${downloadedArchive} to force re-download.`,
      )
    }

    // Clean extraction directory to prevent "File exists" errors from cached layers.
    // This handles cases where Docker cached a partial extraction before failure,
    // or when downloadSocketBtmRelease returns a cached archive with stale extraction.
    // Delete ALL contents except the archive itself to ensure clean extraction.
    // Use safeDelete with retry logic to handle transient filesystem errors.
    const extractDirContents = readdirSync(extractDir)
    const archiveBasename = path.basename(downloadedArchive)
    for (const item of extractDirContents) {
      // Keep the archive and version file, delete everything else
      if (item !== archiveBasename && item !== '.version') {
        const itemPath = path.join(extractDir, item)
        await safeDelete(itemPath, { maxRetries: 3, retryDelay: 100 })
      }
    }

    // Extract using cross-platform tarball utility (handles Windows path conversion).
    // Release tarballs are already flat - no top-level directory to strip.
    try {
      await extractTarball(downloadedArchive, extractDir, {
        createDir: false,
        stdio: 'inherit',
        validate: true,
      })
    } catch (error) {
      // On extraction failure, delete the corrupted archive to allow re-download.
      const versionFile = path.join(extractDir, '.version')
      await safeDelete(downloadedArchive)
      if (existsSync(versionFile)) {
        await safeDelete(versionFile)
      }
      throw new Error(
        `Failed to extract LIEF archive from ${downloadedArchive}: ${error.message}. ` +
          'Deleted corrupted archive to allow re-download on next run.',
        { cause: error },
      )
    }

    // Verify library file exists after extraction.
    const extractedLibPath = getLiefLibPathAt(extractDir)
    if (!extractedLibPath) {
      let dirContents
      try {
        dirContents = readdirSync(extractDir)
      } catch {
        dirContents = ['<unable to read directory>']
      }

      // Library missing after extraction - delete cached files to force re-download on retry.
      // This handles corrupted/incomplete cached tarballs.
      const versionFile = path.join(extractDir, '.version')
      await safeDelete(downloadedArchive)
      if (existsSync(versionFile)) {
        await safeDelete(versionFile)
      }

      throw new Error(
        `LIEF library not found after extraction in ${extractDir}. ` +
          `Directory contains: ${dirContents.join(', ')}. ` +
          `Deleted cached files to allow re-download on retry.`,
      )
    }

    // Verify the downloaded library is compatible with musl if running on musl.
    if (extractedLibPath.endsWith('libLIEF.a')) {
      const compatibility = await verifyMuslCompatibility(extractedLibPath)
      if (!compatibility.compatible) {
        logger.info(
          `Prebuilt LIEF is not compatible with musl: ${compatibility.reason || 'Unknown reason'}`,
        )
        logger.info('Will need to build from source for musl compatibility')
        // Clean up the incompatible download.
        await safeDelete(targetDir)
        return undefined
      }
    }

    logger.success('Successfully downloaded and extracted prebuilt LIEF')
    return extractDir
  } catch (error) {
    logger.info(
      `Failed to download prebuilt LIEF: ${error?.message || 'Unknown error'}`,
    )
    await logTransientErrorHelp(error)
    return undefined
  }
}

// Lock to prevent concurrent LIEF downloads/extractions.
// Key is platformArch, value is promise that resolves when extraction is complete.
const ensureLiefLocks = new Map()

/**
 * Ensure LIEF library is available.
 * Checks local build first, then downloaded, then downloads if needed.
 * Uses a lock to prevent concurrent downloads for the same platform.
 *
 * @param {object} [options] - Options.
 * @param {boolean} [options.force] - Force redownload even if LIEF exists.
 * @param {string} [options.buildMode] - Override build mode.
 * @param {string} [options.platformArch] - Override platform-arch for downloads.
 * @returns {Promise<string>} Path to LIEF library.
 */
export async function ensureLief(options = {}) {
  const resolvedPlatformArch =
    options.platformArch ?? getCurrentLiefPlatformArch()

  // Check if another ensureLief call is already in progress for this platform.
  const existingLock = ensureLiefLocks.get(resolvedPlatformArch)
  if (existingLock) {
    logger.info(
      `Waiting for concurrent LIEF download for ${resolvedPlatformArch}...`,
    )
    return existingLock
  }

  // Create a new lock for this platform.
  const lockPromise = ensureLiefImpl(options)
  ensureLiefLocks.set(resolvedPlatformArch, lockPromise)

  try {
    return await lockPromise
  } finally {
    // Release the lock when done.
    ensureLiefLocks.delete(resolvedPlatformArch)
  }
}

/**
 * Internal implementation of ensureLief.
 */
async function ensureLiefImpl(options = {}) {
  const { force = false, platformArch } = options
  const resolvedPlatformArch = platformArch ?? getCurrentLiefPlatformArch()

  // 1. Check local build first (platform-specific directory).
  const { liefBuildDir } = getLiefBuildDirs(resolvedPlatformArch)
  if (!force && liefExistsAt(liefBuildDir)) {
    const localLibPath = getLiefLibPathAt(liefBuildDir)
    logger.info(`Using local LIEF at ${localLibPath}`)
    return localLibPath
  }

  // 2. Check downloaded version.
  const downloadedDir = getDownloadedLiefDir(resolvedPlatformArch)
  if (!force && liefExistsAt(downloadedDir)) {
    const downloadedLibPath = getLiefLibPathAt(downloadedDir)
    logger.info(`Using downloaded LIEF at ${downloadedLibPath}`)
    return downloadedLibPath
  }

  // 3. Download prebuilt LIEF.
  logger.info('LIEF not found locally, downloading prebuilt...')
  const downloadDir = await downloadPrebuiltLIEF({
    platformArch: resolvedPlatformArch,
  })
  if (downloadDir && liefExistsAt(downloadDir)) {
    const newLibPath = getLiefLibPathAt(downloadDir)
    return newLibPath
  }

  throw new Error(
    'Failed to ensure LIEF. Run: git submodule update --init --recursive packages/lief-builder/upstream/lief',
  )
}

async function main() {
  try {
    // Use platform-specific build directory for complete isolation.
    const platformArch = getCurrentLiefPlatformArch()
    const { buildDir, liefBuildDir } = getLiefBuildDirs(platformArch)
    const downloadedDir = getDownloadedLiefDir(platformArch)

    // Check if LIEF exists in any location (local or downloaded).
    const localLibPath = getLiefLibPathAt(liefBuildDir)
    const downloadedLibPath = getLiefLibPathAt(downloadedDir)
    const liefLibPath = localLibPath ?? downloadedLibPath
    const liefAvailable = liefLibPath !== undefined

    // Check if LIEF is already built.
    const forceRebuild = process.argv.includes('--force')
    const checkpointExists = !(await shouldRun(
      buildDir,
      '',
      CHECKPOINTS.LIEF_BUILT,
      forceRebuild,
    ))

    // Validate checkpoint: both checkpoint file AND library file must exist.
    if (checkpointExists && liefAvailable) {
      logger.success('LIEF already built (checkpoint exists)')
      return
    }

    // If checkpoint exists but library is missing, invalidate and rebuild.
    if (checkpointExists && !liefAvailable) {
      logger.info(
        'Checkpoint exists but LIEF library missing, rebuilding from scratch',
      )
    }

    logger.info('🔨 Building LIEF library...\n')

    // Check if LIEF submodule is initialized.
    const liefSourceDir = path.join(packageRoot, 'upstream', 'lief')
    const liefCMakeLists = path.join(liefSourceDir, 'CMakeLists.txt')
    const isLiefBuild = existsSync(liefCMakeLists)

    if (!isLiefBuild) {
      // Not building LIEF itself - download prebuilt.
      logger.info('LIEF submodule not initialized, downloading prebuilt...')
      const downloadDir = await downloadPrebuiltLIEF({ platformArch })
      if (downloadDir) {
        // Verify library exists after download.
        const liefLibPathNew = getLiefLibPathAt(downloadDir)

        if (liefLibPathNew) {
          const stats = await fs.stat(liefLibPathNew)
          const sizeMB = (stats.size / 1024 / 1024).toFixed(2)

          await createCheckpoint(
            buildDir,
            CHECKPOINTS.LIEF_BUILT,
            async () => {
              // Verify library exists and has reasonable size.
              const libStats = await fs.stat(liefLibPathNew)
              if (libStats.size < 1_000_000) {
                throw new Error(
                  `LIEF library too small: ${libStats.size} bytes (expected >1MB)`,
                )
              }

              // Verify all required files exist.
              logger.info(`Verifying LIEF at: ${downloadDir}`)
              const verification = verifyLiefAt(downloadDir)
              if (!verification.valid) {
                logger.error(`LIEF verification failed!`)
                logger.error(`Checked directory: ${downloadDir}`)
                logger.error(`Missing files: ${verification.missing.join(', ')}`)
                // List what's actually in the directory
                try {
                  const actualContents = readdirSync(downloadDir)
                  logger.error(`Actual contents: ${actualContents.join(', ')}`)
                  if (actualContents.includes('include')) {
                    const includeContents = readdirSync(path.join(downloadDir, 'include'))
                    logger.error(`Contents of include/: ${includeContents.join(', ')}`)
                  }
                } catch (e) {
                  logger.error(`Failed to list directory contents: ${e.message}`)
                }
                throw new Error(
                  `Incomplete LIEF download - missing files:\n  ${verification.missing.join('\n  ')}`,
                )
              }
            },
            {
              artifactPath: downloadDir,
              buildDir: path.relative(packageRoot, downloadDir),
              libPath: path.relative(buildDir, liefLibPathNew),
              libSize: stats.size,
              libSizeMB: sizeMB,
              platformArch,
              version: LIEF_VERSION,
            },
          )
          return
        }
      }

      // Prebuilt download failed - cannot continue.
      throw new Error(
        'Failed to download prebuilt LIEF. Run: git submodule update --init --recursive packages/lief-builder/upstream/lief',
      )
    }

    logger.info(
      `Building LIEF on ${process.platform} for cross-platform binary injection support`,
    )

    // Create build directory.
    await safeMkdir(buildDir)

    // Copy LIEF source from upstream to build directory.
    // This allows patching without modifying the git submodule.
    await copyLiefSource(liefPatchedDir)
    logger.info('LIEF source ready')

    // Apply Socket patches to LIEF source (e.g., remove 1MB note size limit).
    await applyLiefPatches(liefPatchedDir)

    // Create build directory.
    await safeMkdir(liefBuildDir)

    // Configure LIEF with CMake.
    logger.info('Configuring LIEF with CMake...')
    const cmakeArgs = [
      liefPatchedDir,
      '-DCMAKE_BUILD_TYPE=Release',
      '-DLIEF_PYTHON_API=OFF',
      '-DLIEF_C_API=OFF',
      '-DLIEF_EXAMPLES=OFF',
      '-DLIEF_TESTS=OFF',
      '-DLIEF_DOC=OFF',
      '-DLIEF_LOGGING=OFF',
      '-DLIEF_LOGGING_DEBUG=OFF',
      '-DLIEF_ENABLE_JSON=OFF',
    ]

    // Enable LTO (Link-Time Optimization) for Linux glibc builds.
    // This produces LTO bytecode in libLIEF.a that consumers can use with -flto.
    // Must match the GCC version used by consumers (AlmaLinux 8 = GCC 8).
    // Skip for musl (uses different toolchain) and other platforms.
    const isLinuxGlibc =
      process.platform === 'linux' && !(await isMusl()) && !WIN32
    if (isLinuxGlibc) {
      cmakeArgs.push('-DCMAKE_INTERPROCEDURAL_OPTIMIZATION=ON')
      logger.info('Enabling LTO for Linux glibc compatibility')
    }

    // On Windows, use gcc/MinGW for consistent ABI (CI and binsuite)
    // LIEF must use the same compiler/ABI as binject to avoid linker errors
    if (WIN32) {
      // Support cross-compilation via TARGET_ARCH environment variable.
      const targetArch = process.env.TARGET_ARCH
      const isCrossCompileArm64 =
        targetArch === 'arm64' || targetArch === 'aarch64'

      // Use cross-compiler for ARM64, native gcc for x64.
      const cc = isCrossCompileArm64 ? 'aarch64-w64-mingw32-gcc' : 'gcc'
      const cxx = isCrossCompileArm64 ? 'aarch64-w64-mingw32-g++' : 'g++'

      cmakeArgs.push(`-DCMAKE_C_COMPILER=${cc}`, `-DCMAKE_CXX_COMPILER=${cxx}`)

      // Use MinGW Makefiles generator for MinGW toolchain
      cmakeArgs.push('-G', 'MinGW Makefiles')

      if (isCrossCompileArm64) {
        // Set target system for CMake cross-compilation.
        cmakeArgs.push('-DCMAKE_SYSTEM_NAME=Windows')
        cmakeArgs.push('-DCMAKE_SYSTEM_PROCESSOR=aarch64')
        logger.info(
          'Building LIEF with aarch64-w64-mingw32-gcc for ARM64 cross-compilation',
        )
      } else {
        logger.info('Building LIEF with gcc/g++ using MinGW Makefiles')
      }
    }

    // On musl, disable fortify source to avoid glibc-specific fortify functions.
    // musl libc does not provide __*_chk functions (e.g., __snprintf_chk, __memcpy_chk).
    // This prevents linking errors when binject (built on musl) tries to link LIEF.
    // Use -U to undefine first in case it's set elsewhere, then define as 0.
    // The -Wp,-U_FORTIFY_SOURCE passes -U directly to the preprocessor (more reliable).
    const muslLibc = await isMusl()
    if (muslLibc) {
      // Use multiple approaches to ensure _FORTIFY_SOURCE is disabled:
      // 1. -Wp,-U passes to preprocessor directly (bypasses compiler default flags)
      // 2. -U_FORTIFY_SOURCE undefines at compiler level
      // 3. -D_FORTIFY_SOURCE=0 explicitly sets to 0
      const fortifyDisableFlags =
        '-Wp,-U_FORTIFY_SOURCE -U_FORTIFY_SOURCE -D_FORTIFY_SOURCE=0'
      // Set flags for both base and Release configurations.
      // CMAKE_C_FLAGS is the base, CMAKE_C_FLAGS_RELEASE is appended for Release builds.
      // We put fortify flags in both to ensure they're always present.
      cmakeArgs.push(
        `-DCMAKE_C_FLAGS=${fortifyDisableFlags}`,
        `-DCMAKE_CXX_FLAGS=${fortifyDisableFlags}`,
        `-DCMAKE_C_FLAGS_RELEASE=-O3 -DNDEBUG ${fortifyDisableFlags}`,
        `-DCMAKE_CXX_FLAGS_RELEASE=-O3 -DNDEBUG ${fortifyDisableFlags}`,
      )
      logger.info('Disabling fortify source for musl libc compatibility')
    }

    // Use ccache if available.
    // Use the cached which() function instead of spawning a process.
    const ccachePath = await which('ccache')
    if (ccachePath) {
      cmakeArgs.push('-DCMAKE_CXX_COMPILER_LAUNCHER=ccache')
      logger.info('Using ccache for faster compilation')
    } else {
      logger.info('ccache not available, building without cache')
    }

    // Clear compiler flags that may have been set for the main binject build.
    // LIEF build uses its own compiler settings and shouldn't inherit these.
    // Exception: For musl, we must set CFLAGS/CXXFLAGS as environment variables
    // to ensure subdependencies (like mbedtls) also disable fortify source.
    // Use multiple approaches for reliability (see cmake flags comment above).
    const muslFortifyFlags = muslLibc
      ? '-Wp,-U_FORTIFY_SOURCE -U_FORTIFY_SOURCE -D_FORTIFY_SOURCE=0'
      : undefined
    const cleanEnv = {
      // Set LIEF version explicitly for CMake (LIEF's CMakeLists.txt reads this).
      // Required because shallow git clones can't determine version from git tags.
      LIEF_VERSION_ENV: LIEF_VERSION,
      CFLAGS: muslFortifyFlags,
      CXXFLAGS: muslFortifyFlags,
      // CPPFLAGS is specifically for the C PreProcessor - belt and suspenders approach.
      CPPFLAGS: muslLibc ? '-U_FORTIFY_SOURCE -D_FORTIFY_SOURCE=0' : undefined,
      LDFLAGS: undefined,
    }
    await runCommand('cmake', cmakeArgs, liefBuildDir, cleanEnv)
    logger.info('')

    // Build LIEF with parallel compilation.
    // Use 90% of available CPUs for faster builds (CI environments can use full resources).
    const cpuCount = os.cpus().length
    const jobCount = Math.max(1, Math.floor(cpuCount * 0.9))
    logger.info(
      `Building LIEF with ${jobCount} parallel jobs (${cpuCount} CPUs available)...`,
    )
    const buildStart = Date.now()
    // Use the same cleanEnv to ensure subdependencies get the flags.
    await runCommand(
      'cmake',
      ['--build', '.', '--config', 'Release', `-j${jobCount}`],
      liefBuildDir,
      cleanEnv,
    )
    const buildDuration = Math.round((Date.now() - buildStart) / 1000)
    logger.info(
      `LIEF build completed in ${buildDuration}s (${Math.floor(buildDuration / 60)}m ${buildDuration % 60}s)`,
    )
    logger.info('')

    logger.success('LIEF build completed successfully!')

    // Verify library exists (platform-specific naming).
    // When using clang on Windows with Ninja/Unix Makefiles, it produces LIEF.lib (MSVC-style)
    // When using gcc/MinGW on Windows, it produces libLIEF.a (Unix-style)
    // On Unix platforms: libLIEF.a
    let libPath = path.join(liefBuildDir, 'libLIEF.a')
    if (!existsSync(libPath)) {
      // Try Windows MSVC-style naming
      libPath = path.join(liefBuildDir, 'LIEF.lib')
      if (!existsSync(libPath)) {
        throw new Error(
          `LIEF library not found (checked libLIEF.a and LIEF.lib in ${liefBuildDir})`,
        )
      }
    }

    const stats = await fs.stat(libPath)
    const sizeMB = (stats.size / 1024 / 1024).toFixed(2)
    logger.info(`LIEF library size: ${sizeMB} MB`)

    // Verify musl compatibility immediately after build (fail fast).
    const compatibility = await verifyMuslCompatibility(libPath)
    if (!compatibility.compatible) {
      throw new Error(
        `LIEF build produced musl-incompatible library: ${compatibility.reason}. ` +
          'This indicates _FORTIFY_SOURCE was not properly disabled during compilation.',
      )
    }
    if (muslLibc) {
      logger.success(
        'LIEF library verified musl-compatible (no glibc fortify symbols)',
      )
    }

    // Copy upstream headers to build directory for standalone distribution.
    // The checkpoint tarball needs to include all headers required for compilation,
    // not just the generated config.h and version.h from the CMake build.
    logger.info('Copying upstream headers for standalone distribution...')
    const upstreamIncludeDir = path.join(liefUpstream, 'include', 'LIEF')
    const buildIncludeDir = path.join(liefBuildDir, 'include', 'LIEF')

    // Ensure target directory exists.
    await safeMkdir(buildIncludeDir)

    // Recursively copy all header files from upstream to build directory.
    // Parallelized for better performance with many files.
    const copyUpstreamHeaders = async (src, dest) => {
      const entries = await fs.readdir(src, { withFileTypes: true })

      // Separate directories and files for parallel processing.
      const dirs = entries.filter(e => e.isDirectory())
      const files = entries.filter(
        e =>
          e.name.endsWith('.hpp') ||
          e.name.endsWith('.h') ||
          e.name.endsWith('.def'),
      )

      // Create directories first (needed before file copies).
      const dirResults = await Promise.allSettled(
        dirs.map(dir => safeMkdir(path.join(dest, dir.name))),
      )
      const dirFailed = dirResults.filter(r => r.status === 'rejected')
      if (dirFailed.length > 0) {
        throw new Error(
          `Failed to create ${dirFailed.length} directories: ${dirFailed.map(r => r.reason?.message || r.reason).join(', ')}`,
        )
      }

      // Copy files and recurse into subdirectories in parallel.
      const copyResults = await Promise.allSettled([
        ...files.map(file =>
          fs.copyFile(path.join(src, file.name), path.join(dest, file.name)),
        ),
        ...dirs.map(dir =>
          copyUpstreamHeaders(
            path.join(src, dir.name),
            path.join(dest, dir.name),
          ),
        ),
      ])
      const copyFailed = copyResults.filter(r => r.status === 'rejected')
      if (copyFailed.length > 0) {
        throw new Error(
          `Failed to copy ${copyFailed.length} files/directories: ${copyFailed.map(r => r.reason?.message || r.reason).join(', ')}`,
        )
      }
    }

    await copyUpstreamHeaders(upstreamIncludeDir, buildIncludeDir)
    logger.success('Upstream headers copied to build directory')
    logger.info('')

    // Create checkpoint.
    await createCheckpoint(
      buildDir,
      CHECKPOINTS.LIEF_BUILT,
      async () => {
        // Verify library exists and has reasonable size.
        const libStats = await fs.stat(libPath)
        if (libStats.size < 1_000_000) {
          throw new Error(
            `LIEF library too small: ${libStats.size} bytes (expected >1MB)`,
          )
        }

        // Verify all required files exist.
        const verification = verifyLiefAt(liefBuildDir)
        if (!verification.valid) {
          throw new Error(
            `Incomplete LIEF build - missing files:\n  ${verification.missing.join('\n  ')}`,
          )
        }
      },
      {
        artifactPath: liefBuildDir,
        buildDir: path.relative(packageRoot, liefBuildDir),
        libPath: path.relative(buildDir, libPath),
        libSize: stats.size,
        libSizeMB: sizeMB,
        platformArch,
        version: LIEF_VERSION,
      },
    )
  } catch (error) {
    logger.info('')
    logger.fail(`LIEF build failed: ${error?.message || 'Unknown error'}`)
    await logTransientErrorHelp(error)
    throw error
  }
}

// Run main only when executed directly (not when imported).
const isMainModule =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith('build.mjs')

if (isMainModule) {
  main()
}
