/**
 * Build script for libpq PostgreSQL client library.
 * Downloads prebuilt libpq from GitHub releases or builds from source.
 *
 * This builds a minimal static libpq with SSL support using OpenSSL,
 * for embedded use in Node.js native bindings.
 *
 * Key design decisions:
 * - Uses OpenSSL for TLS (same as Node.js, allows sharing)
 * - Builds only the client library (libpq), not the full PostgreSQL server
 * - Produces static library for embedding
 */

import { existsSync, promises as fs, readdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { fileURLToPath } from 'node:url'

import { checkBuildSourceFlag } from 'build-infra/lib/build-env'
import { createCheckpoint, shouldRun } from 'build-infra/lib/checkpoint-manager'
import {
  BUILD_STAGES,
  CHECKPOINTS,
  CHECKPOINT_CHAINS,
  getPlatformBuildDir,
  validateCheckpointChain,
} from 'build-infra/lib/constants'
import { logTransientErrorHelp } from 'build-infra/lib/github-error-utils'
import {
  getCurrentPlatformArch,
  isMusl,
} from 'build-infra/lib/platform-mappings'
import { verifyReleaseChecksum } from 'build-infra/lib/release-checksums'
import { extractTarball } from 'build-infra/lib/tarball-utils'
import { getSubmoduleVersion } from 'build-infra/lib/version-helpers'
import { errorMessage } from 'build-infra/lib/error-utils'

import { WIN32 } from '@socketsecurity/lib/constants/platform'
import { safeDelete, safeMkdir } from '@socketsecurity/lib/fs'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { downloadSocketBtmRelease } from '@socketsecurity/lib/releases/socket-btm'
import { spawn } from '@socketsecurity/lib/spawn'

const logger = getDefaultLogger()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/**
 * Get checkpoint chain for CI workflows.
 * @returns {string[]} Checkpoint chain in reverse dependency order
 */
export function getCheckpointChain() {
  // libpq has no dependencies on other socket-btm packages
  return [CHECKPOINTS.FINALIZED]
}

const packageRoot = path.join(__dirname, '..')
const postgresUpstream = path.join(packageRoot, 'upstream', 'postgres')

const CROSS_COMPILE = process.env.CROSS_COMPILE === '1'
const TARGET_ARCH = process.env.TARGET_ARCH || process.arch

/**
 * Get build directories for a given platform-arch.
 *
 * @param {string} platformArch - Platform-arch identifier.
 * @returns {{ buildDir: string, libpqBuildDir: string }}
 */
function getBuildDirs(platformArch) {
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
 * @returns {Promise<{valid: boolean, expected?: string, actual?: string, skipped?: boolean}>}
 */
async function verifyArchiveChecksum(archivePath, assetName) {
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
 * @returns {Promise<string>} Path to downloaded libpq directory.
 */
export async function downloadLibpq(options = {}) {
  const { force = false, platformArch } = options
  const resolvedPlatformArch = platformArch ?? (await getCurrentPlatformArch())

  // Check if download is blocked by BUILD_DEPS_FROM_SOURCE environment flag.
  checkBuildSourceFlag('libpq', 'DEPS', {
    buildCommand: 'node scripts/build.mts',
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
  logger.info('Extracting libpq archive...')

  // Verify archive exists before extraction.
  if (!existsSync(downloadedArchive)) {
    throw new Error(
      `Downloaded archive not found at expected path: ${downloadedArchive}`,
    )
  }

  // Verify tarball integrity before extraction.
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
  logger.info('Verifying archive checksum...')
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
  } catch (error) {
    await safeDelete(downloadedArchive)
    if (existsSync(versionFile)) {
      await safeDelete(versionFile)
    }
    throw new Error(
      `Failed to extract libpq archive from ${downloadedArchive}: ${errorMessage(error)}. ` +
        'Deleted corrupted archive to allow re-download on next run.',
      { cause: error },
    )
  }

  // Verify expected files exist after extraction.
  for (const file of LIBPQ_REQUIRED_FILES) {
    if (!existsSync(path.join(extractDir, file))) {
      throw new Error(`Expected file not found after extraction: ${file}`)
    }
  }

  // Write version file after cleanup.
  await fs.writeFile(versionFile, POSTGRES_VERSION, 'utf8')

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
 * @returns {Promise<string>} Path to directory containing libpq libraries.
 */
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
  logger.info('libpq not found locally, downloading...')
  return await downloadLibpq({ force, platformArch: resolvedPlatformArch })
}

// PostgreSQL version (extracted from .gitmodules comment).
const POSTGRES_VERSION = getPostgresVersion()

/**
 * Extract PostgreSQL version from .gitmodules comment.
 * @returns {string} PostgreSQL version (e.g., "16.6")
 */
function getPostgresVersion() {
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
    throw new Error(`Command failed to spawn: ${errorMessage(result.error)}`)
  }

  if (result.signal) {
    throw new Error(`Command terminated by signal: ${result.signal}`)
  }

  if (result.code !== 0) {
    throw new Error(`Command failed with exit code ${result.code}`)
  }
}

/**
 * Get OpenSSL paths from node-smol-builder upstream.
 * Node.js bundles OpenSSL in deps/openssl.
 *
 * @returns {{ includeDir: string, libDir: string }} OpenSSL paths
 */
function getNodeOpenSSLPaths() {
  // Node.js OpenSSL is in node-smol-builder's upstream
  const nodeUpstream = path.join(
    packageRoot,
    '..',
    'node-smol-builder',
    'upstream',
    'node',
  )
  const opensslInclude = path.join(
    nodeUpstream,
    'deps',
    'openssl',
    'openssl',
    'include',
  )
  const opensslLib = path.join(nodeUpstream, 'deps', 'openssl', 'openssl')

  return {
    includeDir: opensslInclude,
    libDir: opensslLib,
  }
}

/**
 * Build libpq static library from PostgreSQL source.
 *
 * @param {string} libpqBuildDir - Directory to build libpq in.
 */
async function buildLibpq(libpqBuildDir) {
  logger.info('Building libpq from PostgreSQL source...')

  // Check if PostgreSQL upstream exists.
  if (!existsSync(postgresUpstream)) {
    throw new Error(
      `PostgreSQL upstream not found at ${postgresUpstream}. Run 'git submodule update --init --recursive' first.`,
    )
  }

  // Create build directory.
  await safeMkdir(libpqBuildDir)

  // Get OpenSSL paths from Node.js
  const { includeDir: opensslInclude, libDir: opensslLib } =
    getNodeOpenSSLPaths()

  // Check if Node.js OpenSSL exists
  if (!existsSync(opensslInclude)) {
    logger.warn(
      `Node.js OpenSSL not found at ${opensslInclude}, will try system OpenSSL`,
    )
  }

  // Configure PostgreSQL for client-only build.
  // PostgreSQL uses autotools (configure), not CMake.
  logger.info('Configuring PostgreSQL for libpq-only build...')

  const configureArgs = [
    // Only build client libraries (libpq)
    '--without-server',
    // Disable readline for minimal build
    '--without-readline',
    // Use OpenSSL for TLS
    '--with-openssl',
    // Install prefix
    `--prefix=${libpqBuildDir}/dist`,
  ]

  // Add OpenSSL paths if available
  if (existsSync(opensslInclude)) {
    configureArgs.push(`--with-includes=${opensslInclude}`)
    configureArgs.push(`--with-libraries=${opensslLib}`)
  }

  // Handle cross-compilation
  if (process.platform === 'darwin' && CROSS_COMPILE) {
    const targetTriple =
      TARGET_ARCH === 'x64' ? 'x86_64-apple-darwin' : 'aarch64-apple-darwin'
    configureArgs.push(`--host=${targetTriple}`)
    logger.info(`Cross-compiling libpq for ${targetTriple}`)
  }

  // On musl, disable fortify source.
  const cleanEnv = {}
  if (await isMusl()) {
    const fortifyDisableFlags =
      '-Wp,-U_FORTIFY_SOURCE -U_FORTIFY_SOURCE -D_FORTIFY_SOURCE=0'
    cleanEnv.CFLAGS = fortifyDisableFlags
    cleanEnv.CPPFLAGS = '-U_FORTIFY_SOURCE -D_FORTIFY_SOURCE=0'
    logger.info('Disabling fortify source for musl libc compatibility')
  }

  // Run configure from the upstream directory
  await runCommand(
    path.join(postgresUpstream, 'configure'),
    configureArgs,
    libpqBuildDir,
    cleanEnv,
  )

  // Build only the interfaces/libpq directory
  // PostgreSQL Makefile supports building specific subdirectories
  const cpuCount = os.cpus().length
  const jobCount = Math.max(1, Math.floor(cpuCount * 0.9))
  logger.info(`Building libpq with ${jobCount} parallel jobs...`)

  const buildStart = Date.now()

  // First build common dependencies
  await runCommand(
    'make',
    [`-j${jobCount}`, '-C', 'src/common'],
    libpqBuildDir,
    cleanEnv,
  )

  // Build port utilities
  await runCommand(
    'make',
    [`-j${jobCount}`, '-C', 'src/port'],
    libpqBuildDir,
    cleanEnv,
  )

  // Build libpq
  await runCommand(
    'make',
    [`-j${jobCount}`, '-C', 'src/interfaces/libpq'],
    libpqBuildDir,
    cleanEnv,
  )

  const buildDuration = Math.round((Date.now() - buildStart) / 1000)
  logger.info(`libpq build completed in ${buildDuration}s`)

  logger.success('libpq build completed successfully!')
}

/**
 * Copy headers and libraries for distribution.
 *
 * @param {string} libpqBuildDir - Directory containing libpq build.
 */
async function copyDistributionFiles(libpqBuildDir) {
  const distDir = path.join(libpqBuildDir, 'dist')
  await safeMkdir(distDir)
  await safeMkdir(path.join(distDir, 'include'))

  // Copy libpq static library
  const libpqSrc = path.join(
    libpqBuildDir,
    'src',
    'interfaces',
    'libpq',
    'libpq.a',
  )
  if (!existsSync(libpqSrc)) {
    throw new Error(`libpq library not found: ${libpqSrc}`)
  }
  await fs.copyFile(libpqSrc, path.join(distDir, 'libpq.a'))

  // Copy common library (needed for linking)
  const commonLibSrc = path.join(
    libpqBuildDir,
    'src',
    'common',
    'libpgcommon.a',
  )
  if (existsSync(commonLibSrc)) {
    await fs.copyFile(commonLibSrc, path.join(distDir, 'libpgcommon.a'))
  }

  // Copy port library (needed for linking)
  const portLibSrc = path.join(libpqBuildDir, 'src', 'port', 'libpgport.a')
  if (existsSync(portLibSrc)) {
    await fs.copyFile(portLibSrc, path.join(distDir, 'libpgport.a'))
  }

  // Copy libpq headers from upstream
  const headersSrc = path.join(postgresUpstream, 'src', 'interfaces', 'libpq')
  const headersDst = path.join(distDir, 'include')

  // Copy libpq-fe.h (main header)
  const libpqFeHeader = path.join(headersSrc, 'libpq-fe.h')
  if (existsSync(libpqFeHeader)) {
    await fs.copyFile(libpqFeHeader, path.join(headersDst, 'libpq-fe.h'))
  }

  // Copy postgres_ext.h from include directory
  const postgresExtHeader = path.join(
    postgresUpstream,
    'src',
    'include',
    'postgres_ext.h',
  )
  if (existsSync(postgresExtHeader)) {
    await fs.copyFile(
      postgresExtHeader,
      path.join(headersDst, 'postgres_ext.h'),
    )
  }

  // Copy pg_config.h from build directory (generated by configure)
  const pgConfigHeader = path.join(
    libpqBuildDir,
    'src',
    'include',
    'pg_config.h',
  )
  if (existsSync(pgConfigHeader)) {
    await fs.copyFile(pgConfigHeader, path.join(headersDst, 'pg_config.h'))
  }

  // Copy pg_config_ext.h
  const pgConfigExtHeader = path.join(
    libpqBuildDir,
    'src',
    'include',
    'pg_config_ext.h',
  )
  if (existsSync(pgConfigExtHeader)) {
    await fs.copyFile(
      pgConfigExtHeader,
      path.join(headersDst, 'pg_config_ext.h'),
    )
  }

  logger.success(`Distribution files copied to ${distDir}`)
  return distDir
}

async function main() {
  try {
    // Use platform-specific build directory for complete isolation.
    const platformArch = await getCurrentPlatformArch()
    const { buildDir, libpqBuildDir } = getBuildDirs(platformArch)

    // Determine which libpq library file to check for.
    const libpqLibPath = path.join(
      libpqBuildDir,
      'src',
      'interfaces',
      'libpq',
      'libpq.a',
    )
    const libpqDistPath = path.join(libpqBuildDir, 'dist', 'libpq.a')

    // Check if libpq is already built (finalized checkpoint).
    const forceRebuild = process.argv.includes('--force')
    const finalizedExists = !(await shouldRun(
      buildDir,
      '',
      CHECKPOINTS.FINALIZED,
      forceRebuild,
    ))

    // Validate checkpoint: both checkpoint file AND library file must exist.
    if (
      finalizedExists &&
      (existsSync(libpqLibPath) || existsSync(libpqDistPath))
    ) {
      logger.success('libpq already built (finalized checkpoint exists)')
      return
    }

    // If checkpoint exists but library is missing, invalidate and rebuild.
    if (
      finalizedExists &&
      !existsSync(libpqLibPath) &&
      !existsSync(libpqDistPath)
    ) {
      logger.info(
        'Checkpoint exists but libpq library missing, rebuilding from scratch',
      )
    }

    logger.info('Building libpq PostgreSQL client library...\n')

    // Ensure PostgreSQL submodule is initialized.
    const postgresConfigure = path.join(postgresUpstream, 'configure')
    if (!existsSync(postgresConfigure)) {
      logger.info('PostgreSQL submodule not initialized, initializing...')
      const initResult = await spawn(
        'git',
        [
          'submodule',
          'update',
          '--init',
          '--depth',
          '1',
          'packages/libpq-builder/upstream/postgres',
        ],
        { cwd: path.resolve(packageRoot, '../..'), stdio: 'inherit' },
      )
      if ((initResult.code ?? 0) !== 0 || !existsSync(postgresConfigure)) {
        throw new Error(
          'Failed to initialize PostgreSQL submodule. Run manually:\n' +
            '  git submodule update --init packages/libpq-builder/upstream/postgres',
        )
      }
      logger.success('PostgreSQL submodule initialized')
    }

    const isPostgresBuild = existsSync(postgresConfigure)

    if (!isPostgresBuild) {
      // Should not reach here after auto-init above.
      const libpqDir = await ensureLibpq()
      const libpqLib = path.join(libpqDir, 'libpq.a')
      const stats = await fs.stat(libpqLib)
      const sizeMB = (stats.size / 1024 / 1024).toFixed(2)

      await safeMkdir(buildDir)
      await createCheckpoint(
        buildDir,
        CHECKPOINTS.FINALIZED,
        async () => {
          // Verify library exists and has reasonable size.
          const libStats = await fs.stat(libpqLib)
          if (libStats.size < 10_000) {
            throw new Error(
              `libpq library too small: ${libStats.size} bytes (expected >10KB)`,
            )
          }
        },
        {
          artifactPath: libpqDir,
          buildDir: path.relative(packageRoot, libpqDir),
          libPath: path.relative(buildDir, libpqLib),
          libSize: stats.size,
          libSizeMB: sizeMB,
          platformArch,
          version: POSTGRES_VERSION,
        },
      )
      return
    }

    logger.info(
      `Building libpq from PostgreSQL ${POSTGRES_VERSION} on ${process.platform}`,
    )

    // Create build directory.
    await safeMkdir(buildDir)

    // Build libpq.
    await buildLibpq(libpqBuildDir)

    // Copy distribution files.
    const distDir = await copyDistributionFiles(libpqBuildDir)

    // Verify library exists.
    const libPath = path.join(distDir, 'libpq.a')
    if (!existsSync(libPath)) {
      throw new Error(`libpq library not found at ${libPath}`)
    }

    const stats = await fs.stat(libPath)
    const sizeMB = (stats.size / 1024 / 1024).toFixed(2)
    logger.info(`libpq library size: ${sizeMB} MB`)

    // Create finalized checkpoint.
    await createCheckpoint(
      buildDir,
      CHECKPOINTS.FINALIZED,
      async () => {
        // Verify library exists and has reasonable size.
        const libStats = await fs.stat(libPath)
        if (libStats.size < 10_000) {
          throw new Error(
            `libpq library too small: ${libStats.size} bytes (expected >10KB)`,
          )
        }

        // Verify headers were copied.
        const libpqHeader = path.join(distDir, 'include', 'libpq-fe.h')
        if (!existsSync(libpqHeader)) {
          throw new Error(`libpq headers not found at ${libpqHeader}`)
        }
      },
      {
        artifactPath: distDir,
        buildDir: path.relative(packageRoot, libpqBuildDir),
        libPath: path.relative(buildDir, libPath),
        libSize: stats.size,
        libSizeMB: sizeMB,
        platformArch,
        version: POSTGRES_VERSION,
      },
    )
  } catch (error) {
    logger.log('')
    logger.fail(`libpq build failed: ${errorMessage(error)}`)
    await logTransientErrorHelp(error)
    throw error
  }
}

// Run main only when executed directly (not when imported).
const isMainModule =
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])

if (isMainModule) {
  main().catch(error => {
    logger.error('Error building libpq:', error)
    process.exitCode = 1
  })
}
