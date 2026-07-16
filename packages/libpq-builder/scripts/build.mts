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
 * - Produces static library for embedding.
 *
 * Utilities are split into:
 * - build-download.mts: download, verify, and resolve functions
 * - build-compile.mts: configure, compile, and package functions.
 */

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { fileURLToPath } from 'node:url'

import { createCheckpoint, shouldRun } from 'build-infra/lib/checkpoint-manager'
import { CHECKPOINTS } from 'build-infra/lib/constants'
import { getCurrentPlatformArch } from 'build-infra/lib/platform-mappings'
import { errorMessage } from 'build-infra/lib/error-utils'

import { safeMkdir } from '@socketsecurity/lib-stable/fs/safe'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import {
  downloadLibpq,
  ensureLibpq,
  getBuildDirs,
  getCheckpointChain,
  getPostgresVersion,
  libpqExistsAt,
  logger,
  packageRoot,
  POSTGRES_VERSION,
  postgresUpstream,
  TARGET_ARCH,
  verifyArchiveChecksum,
} from './build-download.mts'
import {
  buildLibpq,
  copyDistributionFiles,
  getNodeOpenSSLPaths,
  getOpenSSLPaths,
  runCommand,
} from './build-compile.mts'

export {
  POSTGRES_VERSION,
  TARGET_ARCH,
  buildLibpq,
  copyDistributionFiles,
  downloadLibpq,
  ensureLibpq,
  getBuildDirs,
  getCheckpointChain,
  getNodeOpenSSLPaths,
  getOpenSSLPaths,
  getPostgresVersion,
  libpqExistsAt,
  runCommand,
  verifyArchiveChecksum,
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

    logger.info('Building libpq PostgreSQL client library…')
    logger.error('')

    // Ensure PostgreSQL submodule is initialized.
    const postgresConfigure = path.join(postgresUpstream, 'configure')
    if (!existsSync(postgresConfigure)) {
      logger.info('PostgreSQL submodule not initialized, initializing…')
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
      // Check signal + error before fallback-to-0 — a SIGTERM/SIGKILL kills
      // the child with code === null, and `?? 0` would otherwise pass the
      // check while leaving the submodule half-initialized.
      if (
        initResult.signal ||
        initResult.error ||
        (initResult.code ?? 1) !== 0 ||
        !existsSync(postgresConfigure)
      ) {
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
      // oxlint-disable-next-line socket/prefer-exists-sync -- multiple fs.stat() calls consume stats.size for downloaded-archive / built-library size reporting and minimum-size quick checks.
      const stats = await fs.stat(libpqLib)
      const sizeMB = (stats.size / 1024 / 1024).toFixed(2)

      await safeMkdir(buildDir)
      await createCheckpoint(
        buildDir,
        CHECKPOINTS.FINALIZED,
        async () => {
          // Verify library exists and has reasonable size.
          // oxlint-disable-next-line socket/prefer-exists-sync -- multiple fs.stat() calls consume stats.size for downloaded-archive / built-library size reporting and minimum-size quick checks.
          const libStats = await fs.stat(libpqLib)
          if (libStats.size < 10_000) {
            throw new Error(
              `libpq library too small: ${libStats.size} bytes (expected >10KB)`,
            )
          }
        },
        {
          arch: TARGET_ARCH,
          artifactPath: libpqDir,
          buildDir: path.relative(packageRoot, libpqDir),
          libPath: path.relative(buildDir, libpqLib),
          libSize: stats.size,
          libSizeMB: sizeMB,
          platform: process.platform,
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

    // oxlint-disable-next-line socket/prefer-exists-sync -- multiple fs.stat() calls consume stats.size for downloaded-archive / built-library size reporting and minimum-size quick checks.
    const stats = await fs.stat(libPath)
    const sizeMB = (stats.size / 1024 / 1024).toFixed(2)
    logger.info(`libpq library size: ${sizeMB} MB`)

    // Create finalized checkpoint.
    await createCheckpoint(
      buildDir,
      CHECKPOINTS.FINALIZED,
      async () => {
        // Verify library exists and has reasonable size.
        // oxlint-disable-next-line socket/prefer-exists-sync -- multiple fs.stat() calls consume stats.size for downloaded-archive / built-library size reporting and minimum-size quick checks.
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
        arch: TARGET_ARCH,
        artifactPath: distDir,
        buildDir: path.relative(packageRoot, libpqBuildDir),
        libPath: path.relative(buildDir, libPath),
        libSize: stats.size,
        libSizeMB: sizeMB,
        platform: process.platform,
        platformArch,
        version: POSTGRES_VERSION,
      },
    )
  } catch (e) {
    logger.log('')
    logger.fail(`libpq build failed: ${errorMessage(e)}`)
    try {
      const { logTransientErrorHelp } =
        await import('build-infra/lib/github-error-utils')
      await logTransientErrorHelp(e)
    } catch {
      // Hint module failed to load — original error already logged.
    }
    throw e
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
