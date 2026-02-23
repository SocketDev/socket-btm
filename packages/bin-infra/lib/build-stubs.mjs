/**
 * Build script for smol_stub self-extracting binaries.
 * Downloads prebuilt stubs from GitHub releases or builds from source.
 *
 * This builds minimal launcher binaries that extract compressed payloads
 * and call binflate to decompress them.
 */

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { createCheckpoint, shouldRun } from 'build-infra/lib/checkpoint-manager'
import {
  CHECKPOINT_CHAINS,
  CHECKPOINTS,
  getBuildMode,
  validateCheckpointChain,
} from 'build-infra/lib/constants'
import {
  getAssetPlatformArch,
  tarSupportsNoAbsoluteNames,
} from 'build-infra/lib/platform-mappings'

import { envAsBoolean } from '@socketsecurity/lib/env'
import { safeDelete, safeMkdir } from '@socketsecurity/lib/fs'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import {
  detectLibc,
  downloadSocketBtmRelease,
} from '@socketsecurity/lib/releases/socket-btm'
import { spawn } from '@socketsecurity/lib/spawn'

import { ensureCurl } from '../../bin-stubs/scripts/build-curl.mjs'

const logger = getDefaultLogger()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const packageRoot = path.join(__dirname, '..')

const BUILD_MODE = getBuildMode()
const buildDir = path.join(packageRoot, 'build', BUILD_MODE)

// Stub source directory (in bin-stubs package).
const stubDir = path.join(packageRoot, '..', 'bin-stubs')

// Output directory for locally built stubs.
// Matches Makefile's OUT_DIR = build/$(BUILD_MODE)/out/Final
const stubOutDir = path.join(stubDir, 'build', BUILD_MODE, 'out', 'Final')

/**
 * Get checkpoint chain for CI workflows.
 * @returns {string[]} Checkpoint chain in reverse dependency order
 */
export function getCheckpointChain() {
  const chain = CHECKPOINT_CHAINS.simple()
  validateCheckpointChain(chain, 'build-stubs')
  return chain
}

/**
 * Get stub binary name for the current platform.
 * @returns {string} Stub binary name
 */
function getStubBinaryName() {
  return process.platform === 'win32' ? 'smol_stub.exe' : 'smol_stub'
}

/**
 * Get current platform-arch for stubs.
 * Respects TARGET_ARCH environment variable for cross-compilation.
 * @returns {Promise<string>} Platform-arch identifier.
 */
async function getCurrentStubPlatformArch() {
  const libc = detectLibc()
  // Respect TARGET_ARCH for cross-compilation (from environment or process.arch)
  const targetArch = process.env.TARGET_ARCH || process.arch
  const arch = targetArch === 'x64' ? 'x64' : targetArch
  // Use asset platform naming (win instead of win32).
  return getAssetPlatformArch(process.platform, arch, libc)
}

/**
 * Get the local build directory for stubs.
 *
 * @returns {string} Path to local stub build directory.
 */
export function getLocalStubDir() {
  return stubOutDir
}

/**
 * Get the downloaded stubs directory for a platform-arch.
 *
 * @param {string} platformArch - Platform-arch identifier (e.g., 'linux-x64-musl').
 * @returns {string} Path to downloaded stubs directory.
 */
export function getDownloadedStubDir(platformArch) {
  return path.join(packageRoot, 'build', 'downloaded', 'stubs', platformArch)
}

/**
 * Check if stub binary exists at a given directory.
 *
 * @param {string} dir - Directory to check.
 * @returns {boolean} True if stub binary exists.
 */
export function stubExistsAt(dir) {
  const stubBinary = getStubBinaryName()
  return existsSync(path.join(dir, stubBinary))
}

/**
 * Get Makefile name for the current platform.
 * @returns {string} Makefile name
 */
function getMakefileName() {
  switch (process.platform) {
    case 'darwin':
      return 'Makefile.macos'
    case 'win32':
      return 'Makefile.windows'
    default:
      return 'Makefile.linux'
  }
}

/**
 * Download prebuilt stub from GitHub releases.
 *
 * @param {object} [options] - Download options.
 * @param {string} [options.platformArch] - Override platform-arch.
 * @returns {Promise<string|null>} Path to downloaded stub directory, or null on failure.
 */
async function downloadPrebuiltStub(options = {}) {
  const { platformArch } = options
  const resolvedPlatformArch =
    platformArch ?? (await getCurrentStubPlatformArch())

  // Check if download is blocked by environment.
  const buildAllFromSource = envAsBoolean(process.env.BUILD_ALL_FROM_SOURCE)
  const buildDepsFromSource =
    buildAllFromSource || envAsBoolean(process.env.BUILD_DEPS_FROM_SOURCE)
  if (buildDepsFromSource) {
    throw new Error(
      'stubs download blocked by BUILD_DEPS_FROM_SOURCE=true.\n' +
        'Build stubs locally or unset BUILD_DEPS_FROM_SOURCE to allow downloading.',
    )
  }

  logger.info('Checking for prebuilt stubs releases...')

  const assetName = `smol-stub-${resolvedPlatformArch}.tar.gz`
  const targetDir = getDownloadedStubDir(resolvedPlatformArch)

  // downloadSocketBtmRelease creates ${downloadDir}/${tool}/assets/ path structure.
  const downloadBaseDir = path.join(packageRoot, 'build', 'downloaded')
  const tarballPath = path.join(downloadBaseDir, 'stubs', 'assets', assetName)

  // Download archive using socket-btm release helper.
  logger.info(`Downloading ${assetName}...`)

  try {
    await downloadSocketBtmRelease({
      asset: assetName,
      downloadDir: downloadBaseDir,
      tool: 'stubs',
    })

    // Create extraction directory.
    await safeMkdir(targetDir)

    // Extract archive.
    logger.info('Extracting stubs archive...')

    // Path traversal protection: verify tarball contents before extraction.
    const listResult = await spawn('tar', ['-tzf', tarballPath], {
      stdio: 'pipe',
    })
    const files = listResult.stdout
      .split('\n')
      .filter(Boolean)
      .map(f => f.trim())

    // Check for path traversal attempts.
    for (const file of files) {
      const normalized = path.normalize(file)
      if (normalized.startsWith('..') || path.isAbsolute(normalized)) {
        throw new Error(
          `Archive contains unsafe path: ${file} (path traversal attempt detected)`,
        )
      }
    }

    // Extract.
    const tarArgs = ['-xzf', tarballPath, '-C', targetDir]
    if (await tarSupportsNoAbsoluteNames()) {
      tarArgs.push('--no-absolute-names')
    }
    await spawn('tar', tarArgs, { stdio: 'inherit' })

    // Clean up archive.
    await safeDelete(tarballPath)

    logger.success('Successfully downloaded and extracted prebuilt stub')
    return targetDir
  } catch (e) {
    logger.info(
      `Failed to download prebuilt stub: ${e?.message || 'Unknown error'}`,
    )
    return null
  }
}

/**
 * Get stub output directory path.
 *
 * @returns {string} Path to stub output directory.
 */
export function getStubOutDir() {
  return stubOutDir
}

/**
 * Get stub binary path for the current platform.
 *
 * @returns {string} Path to stub binary.
 */
export function getStubPath() {
  return path.join(stubOutDir, getStubBinaryName())
}

/**
 * Check if stub binary exists.
 *
 * @returns {boolean} True if stub binary exists.
 */
export function stubExists() {
  return existsSync(getStubPath())
}

/**
 * Build stub from source using Makefile.
 */
async function buildStubFromSource() {
  const makefile = getMakefileName()
  logger.info(`Building stub from source using ${makefile}...`)

  // Check if source files exist.
  const sourceFile = path.join(stubDir, 'src')
  if (!existsSync(sourceFile)) {
    throw new Error(`Stub source directory not found: ${sourceFile}`)
  }

  // Build environment.
  const env = { ...process.env }

  // Pass BUILD_MODE to Makefile so it can find curl libraries.
  env.BUILD_MODE = BUILD_MODE

  // For cross-compilation on macOS.
  if (process.env.TARGET_ARCH) {
    env.TARGET_ARCH = process.env.TARGET_ARCH
  }

  // Run make clean all.
  const buildStart = Date.now()
  const result = await spawn('make', ['-f', makefile, 'clean', 'all'], {
    cwd: stubDir,
    env,
    stdio: 'inherit',
  })

  if (result.code !== 0) {
    throw new Error(`Make failed with exit code ${result.code}`)
  }

  const buildDuration = Math.round((Date.now() - buildStart) / 1000)
  logger.info(`Stub build completed in ${buildDuration}s`)

  logger.success('Stub build completed successfully!')
}

/**
 * Ensure stub binary is available.
 * Checks local build first, then downloaded, then builds/downloads if needed.
 *
 * @param {object} [options] - Options.
 * @param {boolean} [options.force] - Force rebuild even if stub exists.
 * @param {string} [options.platformArch] - Override platform-arch for downloads.
 * @returns {Promise<string>} Path to stub binary.
 */
export async function ensureStubs(options = {}) {
  const { force = false, platformArch } = options
  const resolvedPlatformArch =
    platformArch ?? (await getCurrentStubPlatformArch())
  const stubBinary = getStubBinaryName()

  // 1. Check local build first.
  const localDir = getLocalStubDir()
  if (!force && stubExistsAt(localDir)) {
    const localPath = path.join(localDir, stubBinary)
    logger.info(`Using local stub at ${localPath}`)
    return localPath
  }

  // 2. Check downloaded version.
  const downloadedDir = getDownloadedStubDir(resolvedPlatformArch)
  if (!force && stubExistsAt(downloadedDir)) {
    const downloadedPath = path.join(downloadedDir, stubBinary)
    logger.info(`Using downloaded stub at ${downloadedPath}`)
    return downloadedPath
  }

  // 3. Check if we can build from source (Makefile exists).
  const makefile = getMakefileName()
  const makefilePath = path.join(stubDir, makefile)
  const canBuildFromSource = existsSync(makefilePath)

  if (!canBuildFromSource) {
    // Download prebuilt.
    logger.info('Makefile not found, downloading prebuilt stub...')
    const downloadDir = await downloadPrebuiltStub({
      platformArch: resolvedPlatformArch,
    })
    if (!downloadDir) {
      throw new Error(
        `Failed to download prebuilt stub and cannot build from source (${makefile} not found)`,
      )
    }
    return path.join(downloadDir, stubBinary)
  }

  // Try to build from source.
  try {
    // Ensure curl libraries are available (required for HTTPS support in stubs).
    logger.info('Ensuring curl libraries are available...')
    try {
      const curlDir = await ensureCurl()
      logger.success(`curl libraries ready at ${curlDir}`)
    } catch (curlError) {
      logger.info(
        `Could not ensure curl (${curlError?.message || 'Unknown error'}), stub may build without HTTPS support`,
      )
    }

    await buildStubFromSource()
    return path.join(localDir, stubBinary)
  } catch (e) {
    logger.info(`Source build failed: ${e?.message || 'Unknown error'}`)

    // In CI (stub build workflow), fail immediately without fallback.
    if ('CI' in process.env) {
      throw new Error(
        `Stub build from source failed in CI - no fallback allowed: ${e?.message || 'Unknown error'}`,
      )
    }

    logger.info('Falling back to prebuilt download...')

    const downloadDir = await downloadPrebuiltStub({
      platformArch: resolvedPlatformArch,
    })
    if (!downloadDir) {
      throw new Error(
        'Failed to build stub from source and prebuilt download also failed',
      )
    }
    return path.join(downloadDir, stubBinary)
  }
}

async function main() {
  try {
    const forceRebuild = process.argv.includes('--force')

    // Check if stub is already built (finalized checkpoint).
    const finalizedExists = !(await shouldRun(
      buildDir,
      '',
      CHECKPOINTS.FINALIZED,
      forceRebuild,
    ))

    // Check if stub exists in any location (local or downloaded).
    const localDir = getLocalStubDir()
    const platformArch = await getCurrentStubPlatformArch()
    const downloadedDir = getDownloadedStubDir(platformArch)

    const stubAvailable = stubExistsAt(localDir) || stubExistsAt(downloadedDir)

    // Validate checkpoint: both checkpoint file AND binary must exist.
    if (finalizedExists && stubAvailable) {
      logger.success('Stub already built (finalized checkpoint exists)')
      return
    }

    // If checkpoint exists but binary is missing, invalidate and rebuild.
    if (finalizedExists && !stubAvailable) {
      logger.info(
        'Checkpoint exists but stub binary missing, rebuilding from scratch',
      )
    }

    logger.info(`Building smol_stub for ${process.platform}...\n`)

    // Ensure stubs are available.
    const stubPath = await ensureStubs({ force: forceRebuild })

    const stats = await fs.stat(stubPath)
    const sizeKB = (stats.size / 1024).toFixed(2)
    logger.info(`Stub binary size: ${sizeKB} KB`)

    // Create build directory if needed.
    await safeMkdir(buildDir)

    // Create finalized checkpoint.
    await createCheckpoint(
      buildDir,
      CHECKPOINTS.FINALIZED,
      async () => {
        // Verify binary exists and has reasonable size (< 200KB for stub).
        const stubStats = await fs.stat(stubPath)
        if (stubStats.size > 200_000) {
          logger.info(
            `Warning: Stub is larger than expected: ${stubStats.size} bytes`,
          )
        }
      },
      {
        arch: process.arch,
        checkpointChain: CHECKPOINT_CHAINS.simple(),
        platform: process.platform,
        stubPath: path.relative(packageRoot, stubPath),
        stubSize: stats.size,
        stubSizeKB: sizeKB,
      },
    )
  } catch (e) {
    logger.info('')
    logger.fail(`Stub build failed: ${e?.message || 'Unknown error'}`)
    throw e
  }
}

// Run main only when executed directly (not when imported).
const isMainModule =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith('build-stubs.mjs')

if (isMainModule) {
  main()
}
