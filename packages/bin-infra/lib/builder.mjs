/**
 * bin-infra Builder
 *
 * Shared build infrastructure for binsuite tools (binpress, binflate, binject).
 * Provides common build logic including checkpoint management, platform detection,
 * Makefile selection, and smoke testing.
 */

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'

import { getFileSize } from 'build-infra/lib/build-helpers'
import { createCheckpoint, shouldRun } from 'build-infra/lib/checkpoint-manager'
import {
  BUILD_STAGES,
  CHECKPOINTS,
  CHECKPOINT_CHAINS,
  getBuildMode,
  getPlatformBuildDir,
} from 'build-infra/lib/constants'
import { getAssetPlatformArch } from 'build-infra/lib/platform-mappings'
import { runCommand } from 'build-infra/lib/script-runner'

import { WIN32 } from '@socketsecurity/lib/constants/platform'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

const logger = getDefaultLogger()

// Re-export runCommand for convenience (single import point for binsuite scripts)
export { runCommand }

/**
 * Check if we're cross-compiling (target arch differs from host arch).
 * When cross-compiling, we can't run the binary for smoke tests.
 *
 * @returns {boolean} True if cross-compiling
 */
function isCrossCompiling() {
  const targetArch = process.env.TARGET_ARCH
  if (!targetArch) {
    return false
  }
  // Normalize arm64/aarch64 to compare correctly.
  const normalizedTarget =
    targetArch === 'aarch64' || targetArch === 'arm64' ? 'arm64' : targetArch
  const normalizedHost = process.arch === 'arm64' ? 'arm64' : process.arch
  return normalizedTarget !== normalizedHost
}

/**
 * Default smoke test that validates binary size and --version output.
 *
 * @param {string} binaryPath - Path to binary
 * @param {string} packageName - Package name to check in version output
 * @returns {Promise<void>}
 */
async function defaultSmokeTest(binaryPath, packageName) {
  // Smoke test: verify binary exists and has reasonable size
  const stats = await fs.stat(binaryPath)
  if (stats.size < 1000) {
    throw new Error(`Binary too small: ${stats.size} bytes (expected >1KB)`)
  }

  // Run --version to ensure binary is functional
  const result = await spawn(binaryPath, ['--version'])
  if (result.code !== 0) {
    throw new Error(
      `Binary --version check failed with exit code ${result.code}`,
    )
  }
  if (!(result.stdout || '').includes(packageName)) {
    throw new Error(
      `Binary --version output missing '${packageName}': ${result.stdout || ''}`,
    )
  }

  logger.info('Binary validated')
}

/**
 * Select platform-specific Makefile.
 *
 * @returns {string} Makefile name
 */
export function selectMakefile() {
  if (process.platform === 'linux') {
    return 'Makefile.linux'
  }
  if (process.platform === 'win32') {
    return 'Makefile.win'
  }
  return 'Makefile.macos'
}

/**
 * Build a C package with common infrastructure.
 *
 * @param {object} config - Build configuration
 * @param {string} config.packageName - Package name (e.g., 'binpress', 'binflate', 'binject')
 * @param {string} config.packageDir - Package root directory
 * @param {Function} [config.beforeBuild] - Optional async hook called before build
 * @param {Function} [config.smokeTest] - Optional async smoke test function (binaryPath) => Promise<void>
 * @param {boolean} [config.skipClean] - Skip cleaning stale build artifacts (default: false)
 * @param {boolean} [config.validateCheckpointWithBinary] - Validate checkpoint requires binary exists (default: false)
 * @returns {Promise<void>}
 */
export async function buildBinSuitePackage(config) {
  const {
    beforeBuild,
    packageDir,
    packageName,
    skipClean = false,
    smokeTest,
    validateCheckpointWithBinary = false,
  } = config

  try {
    // Use platform-specific build directory for complete isolation.
    // This prevents race conditions when multiple platforms build concurrently.
    const targetArch = process.env.TARGET_ARCH || process.arch
    const platformArch = getAssetPlatformArch(process.platform, targetArch)
    const buildDir = getPlatformBuildDir(packageDir, platformArch)

    // Determine binary name and path
    const binaryName =
      process.platform === 'win32' ? `${packageName}.exe` : packageName
    const binaryPath = path.join(
      buildDir,
      'out',
      BUILD_STAGES.FINAL,
      binaryName,
    )

    // Check if build is needed
    const forceRebuild = process.argv.includes('--force')

    // Track source files for cache invalidation
    const sourcePaths = [
      path.join(packageDir, 'src'),
      path.join(packageDir, 'Makefile.*'),
    ]

    const checkpointExists = !(await shouldRun(
      buildDir,
      '',
      CHECKPOINTS.FINALIZED,
      forceRebuild,
      sourcePaths,
      {
        arch: targetArch,
        platform: process.platform,
      },
    ))

    // Basic checkpoint validation
    if (checkpointExists && !validateCheckpointWithBinary) {
      logger.success(`${packageName} already built (checkpoint exists)`)
      return
    }

    // Enhanced checkpoint validation: both checkpoint file AND binary must exist
    if (validateCheckpointWithBinary) {
      if (checkpointExists && existsSync(binaryPath)) {
        logger.success(`${packageName} already built (checkpoint exists)`)
        return
      }

      // If checkpoint exists but binary is missing, invalidate checkpoint
      if (checkpointExists && !existsSync(binaryPath)) {
        logger.info(
          'Checkpoint exists but binary missing, rebuilding from scratch',
        )
      }
    }

    logger.info(`🔨 Building ${packageName}...\n`)

    // Check required build tools
    logger.info('Checking required build tools...')
    await runCommand(
      'node',
      [path.join(packageDir, 'scripts', 'check-tools.mjs')],
      packageDir,
    )
    logger.info('')

    // Run package-specific pre-build hook (includes lzfse initialization)
    if (beforeBuild) {
      await beforeBuild({ buildDir, buildMode: getBuildMode(), packageDir })
      logger.info('')
    }

    // Select platform-specific Makefile
    const makefile = selectMakefile()

    // Build environment - pass PLATFORM_ARCH and BUILD_MODE to Makefile.
    const buildMode = getBuildMode()
    const makeEnv = {
      ...process.env,
      BUILD_MODE: buildMode,
      PLATFORM_ARCH: platformArch,
    }

    // Helper to run make with proper environment.
    const runMake = async args => {
      logger.info(`Running: make ${args.join(' ')}`)
      const result = await spawn('make', args, {
        cwd: packageDir,
        env: makeEnv,
        shell: WIN32,
        stdio: 'inherit',
      })
      if (result.code !== 0) {
        throw new Error(`Make failed with exit code ${result.code}`)
      }
    }

    // Clean stale object files to avoid issues with renamed source files
    if (!skipClean) {
      logger.info('Cleaning stale build artifacts...')
      await runMake(['-f', makefile, 'clean'])
      logger.info('')
    }

    // Run make
    await runMake(['-f', makefile, 'all'])
    logger.info('')
    logger.success('Build completed successfully!')

    // Create checkpoint after successful build with smoke test.
    // Skip smoke test when cross-compiling (can't run ARM64 binary on x64 host).
    if (existsSync(binaryPath)) {
      const binarySize = await getFileSize(binaryPath)
      const crossCompiling = isCrossCompiling()

      if (crossCompiling) {
        logger.info('Skipping smoke test (cross-compiling)')
      }

      await createCheckpoint(
        buildDir,
        CHECKPOINTS.FINALIZED,
        crossCompiling
          ? async () => {
              // No-op: can't run cross-compiled binary on host.
            }
          : async () => {
              if (smokeTest) {
                await smokeTest(binaryPath)
              } else {
                await defaultSmokeTest(binaryPath, packageName)
              }
            },
        {
          artifactPath: path.join(buildDir, 'out', BUILD_STAGES.FINAL),
          binaryPath: path.relative(buildDir, binaryPath),
          binarySize,
          checkpointChain: CHECKPOINT_CHAINS.simple(),
          platformArch,
        },
      )
    }
  } catch (error) {
    logger.info('')
    logger.fail(`Build failed: ${error.message}`)
    throw error
  }
}
