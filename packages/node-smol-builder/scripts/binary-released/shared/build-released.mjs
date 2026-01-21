/**
 * @fileoverview Release Binary Build Phase
 *
 * This script handles the "Release" build phase:
 * 1. Pre-flight checks (tools, environment, compression tools)
 * 2. Source cloning/extraction
 * 3. Patch application
 * 4. Node.js configuration
 * 5. Compilation
 * 6. Binary testing
 * 7. Release checkpoint creation
 *
 * This is the most complex phase containing all the Node.js build logic.
 */

import { existsSync, promises as fs } from 'node:fs'
import { cpus, totalmem } from 'node:os'
import path from 'node:path'

import {
  clearBuildLog,
  createCheckpoint,
  estimateBuildTime,
  exec,
  formatDuration,
  getBuildLogPath,
  getFileSize,
  getLastLogLines,
  needsCacheRebuild,
  saveBuildLog,
  smokeTestBinary,
} from 'build-infra/lib/build-helpers'
import { printError } from 'build-infra/lib/build-output'
import {
  hasCheckpoint,
  restoreCheckpoint,
  shouldRun,
} from 'build-infra/lib/checkpoint-manager'
import { nodeVersionRaw } from 'build-infra/lib/constants'
import colors from 'yoctocolors-cjs'

import { which, whichSync } from '@socketsecurity/lib/bin'
import { WIN32 } from '@socketsecurity/lib/constants/platform'
import { safeDelete, safeMkdir } from '@socketsecurity/lib/fs'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

import { copyBuildAdditions } from './copy-additions.mjs'
import { PATCHES_SOURCE_PATCHED_DIR } from './paths.mjs'
import {
  checkBuildEnvironment,
  checkRequiredTools,
} from './preflight-checks.mjs'
import { cloneNodeSource } from '../../source-cloned/shared/clone-source.mjs'
import { applySocketPatches } from '../../source-patched/shared/apply-patches.mjs'

const logger = getDefaultLogger()

/**
 * Get checkpoint chain for progressive restoration (newest → oldest).
 * Matches CI restore-checkpoint action chain.
 *
 * This function is the single source of truth for checkpoint ordering.
 * CI workflows should use this same function to generate their checkpoint chain.
 *
 * @param {string} _buildMode - Build mode ('dev' or 'prod') - unused for node-smol but kept for API consistency
 * @returns {string[]} Checkpoint chain array
 */
export function getCheckpointChain(_buildMode) {
  // Node-smol-builder chain is same for dev and prod
  // (Other builders like onnxruntime/yoga vary by mode - they skip optimization in dev)
  return [
    'finalized',
    'binary-compressed',
    'binary-stripped',
    'binary-released',
    'source-patched',
    'source-cloned',
  ]
}

/**
 * Build Release binary phase.
 *
 * @param {object} options - Build options
 * @param {string} options.nodeVersion - Node.js version to build
 * @param {string} options.nodeSha - Node.js commit SHA
 * @param {string} options.nodeRepo - Node.js repository URL
 * @param {string} options.buildDir - Build directory
 * @param {string} options.packageName - Package name
 * @param {string} options.sharedBuildDir - Shared build directory
 * @param {string} options.sharedSourceDir - Shared source directory
 * @param {string} options.modeSourceDir - Mode-specific source directory
 * @param {string} options.buildPatchesDir - Build patches directory
 * @param {string} options.outDir - Build out directory
 * @param {string} options.nodeBinary - Node binary path
 * @param {string} options.outputReleaseDir - Release output directory
 * @param {string} options.outputReleaseBinary - Release binary path
 * @param {string} options.cacheDir - Cache directory
 * @param {string} options.testFile - Test file path
 * @param {string} options.bootstrapFile - Bootstrap file path
 * @param {string} options.patchedFile - Patched file path
 * @param {string} options.platform - Target platform
 * @param {string} options.arch - Target architecture
 * @param {string} options.buildMode - Build mode (dev/prod)
 * @param {boolean} options.cleanBuild - Whether this is a clean build
 * @param {boolean} options.autoYes - Auto-yes to prompts
 * @param {boolean} options.isCI - Whether running in CI
 * @param {boolean} options.isProdBuild - Whether this is a production build
 * @param {boolean} options.allowCross - Allow cross-compilation (experimental)
 * @param {function} options.collectBuildSourceFiles - Function to collect build source files
 * @param {string} options.packageRoot - Package root directory
 */
export async function buildRelease(config, buildOptions = {}) {
  const { skipCheckpoint = false } = buildOptions
  const {
    allowCross,
    arch,
    autoYes,
    bootstrapFile,
    buildDir,
    buildMode,
    buildPatchesDir,
    cacheDir,
    cleanBuild,
    collectBuildSourceFiles,
    isProdBuild,
    libc,
    modeSourceDir,
    nodeBinary,
    nodeRepo,
    nodeSha,
    nodeVersion,
    outDir,
    outputReleaseBinary,
    outputReleaseDir,
    packageName,
    packageRoot,
    patchedFile,
    platform,
    sharedBuildDir,
    sharedSourceDir,
    testFile,
  } = config

  // Validate required config properties
  const requiredProps = [
    'arch',
    'buildDir',
    'buildMode',
    'modeSourceDir',
    'nodeBinary',
    'nodeRepo',
    'nodeVersion',
    'outDir',
    'outputReleaseBinary',
    'outputReleaseDir',
    'packageRoot',
    'platform',
    'sharedBuildDir',
    'sharedSourceDir',
  ]
  for (const prop of requiredProps) {
    if (config[prop] === undefined) {
      throw new Error(
        `buildRelease: missing required config property '${prop}'`,
      )
    }
  }

  const _IS_MACOS = platform === 'darwin'
  const IS_WINDOWS = platform === 'win32'
  const IS_LINUX = platform === 'linux'
  const IS_MUSL = libc === 'musl'
  const IS_DEV_BUILD = !isProdBuild

  /**
   * Collect build source files for cache validation.
   */
  function collectSourceFiles() {
    return collectBuildSourceFiles()
  }

  /**
   * Calculate optimal number of parallel build jobs.
   */
  const CPU_COUNT = (() => {
    // Check for explicit override via environment variable
    if (process.env.NODE_BUILD_JOBS) {
      const envJobs = Number.parseInt(process.env.NODE_BUILD_JOBS, 10)
      if (Number.isNaN(envJobs) || envJobs < 1) {
        throw new Error(
          `Invalid NODE_BUILD_JOBS value: ${process.env.NODE_BUILD_JOBS} (must be a positive integer)`,
        )
      }
      return envJobs
    }

    // Adaptive calculation based on available memory
    const totalCpus = cpus().length
    const totalRamGB = Math.floor(totalmem() / (1024 * 1024 * 1024))
    const memoryBasedJobs = Math.floor(totalRamGB / 4)

    // Use the minimum of CPU count and memory-based calculation
    // Ensure at least 1 job even on very low-memory systems
    return Math.max(1, Math.min(totalCpus, memoryBasedJobs))
  })()

  /**
   * Check if Node.js source has uncommitted changes.
   */
  async function isNodeSourceDirty() {
    try {
      const gitPath = await which('git', { nothrow: true })
      if (!gitPath) {
        return false
      }
      const result = await spawn(gitPath, ['status', '--porcelain'], {
        cwd: modeSourceDir,
      })
      return result.code === 0 && (result.stdout ?? '').trim().length > 0
    } catch {
      return false
    }
  }

  /**
   * Convert configure.py flags to vcbuild.bat flags.
   */
  function convertToVcbuildFlags(configureFlags) {
    const vcbuildFlags = []

    // Always add openssl-no-asm
    vcbuildFlags.push('openssl-no-asm')
    vcbuildFlags.push('download-all')

    const flagMap = {
      '--without-npm': 'nonpm',
      '--without-corepack': 'nocorepack',
      '--without-node-options': 'no-NODE-OPTIONS',
      '--without-snapshot': 'nosnapshot',
    }

    for (const flag of configureFlags) {
      if (flag === '--dest-cpu=arm64') {
        vcbuildFlags.push('arm64')
      } else if (flag === '--dest-cpu=x64') {
        vcbuildFlags.push('x64')
      } else if (flag === '--with-intl=small-icu') {
        vcbuildFlags.push('full-icu')
      } else if (flag === '--with-intl=none') {
        vcbuildFlags.push('intl-none')
      } else if (flag === '--enable-lto') {
        vcbuildFlags.push('ltcg')
      } else if (flag === '--ninja') {
        // No-op: Ninja is default
      } else if (flag in flagMap) {
        vcbuildFlags.push(flagMap[flag])
      } else if (flag.startsWith('--without-')) {
        // No-op: Most unsupported
      } else {
        logger.warn(`Unknown vcbuild.bat flag mapping for: ${flag}`)
      }
    }

    return vcbuildFlags
  }

  /**
   * Verify Socket modifications were applied correctly.
   */
  async function verifySocketModifications() {
    logger.step('Verifying Socket Modifications')

    let allApplied = true

    // Check 1: V8 include paths.
    logger.log('Checking V8 include paths...')
    try {
      const content = await fs.readFile(testFile, 'utf8')
      if (content.includes('#include "src/base/iterator.h"')) {
        logger.success(
          `V8 include paths are correct (no modification needed for v${nodeVersionRaw})`,
        )
      } else if (content.includes('#include "base/iterator.h"')) {
        logger.fail('V8 include paths were incorrectly modified!')
        logger.substep(`v${nodeVersionRaw} needs "src/" prefix in includes`)
        logger.substep('Build will fail - source was corrupted')
        allApplied = false
      } else {
        logger.warn('V8 include structure may have changed (cannot verify)')
      }
    } catch (e) {
      logger.warn(`Cannot verify V8 includes: ${e.message}`)
    }

    // Check 2: localeCompare polyfill.
    // The patch adds: require('internal/socketsecurity_polyfills/locale-compare')
    logger.log('Checking polyfill in bootstrap/node.js...')
    try {
      const content = await fs.readFile(bootstrapFile, 'utf8')
      const hasLocaleCompare = content.includes(
        "require('internal/socketsecurity_polyfills/locale-compare')",
      )

      if (hasLocaleCompare) {
        logger.success(
          'bootstrap/node.js correctly modified (localeCompare polyfill applied)',
        )
      } else {
        logger.warn('localeCompare polyfill not applied')
      }
    } catch (e) {
      logger.warn(`Cannot verify bootstrap/node.js: ${e.message}`)
    }

    logger.logNewline()

    if (!allApplied) {
      printError(
        'Socket Modifications Not Applied',
        'Critical Socket modifications were not applied to Node.js source.',
        [
          'This is a BUG in the build script',
          'The binary will NOT work correctly with pkg',
          'Run: pnpm build --clean',
          'Report this issue if it persists',
        ],
      )
      throw new Error('Socket modifications verification failed')
    }

    logger.success(
      'All Socket modifications verified for --with-intl=small-icu',
    )
    logger.logNewline()
  }

  // ============================================================================
  // MAIN RELEASE BUILD LOGIC
  // ============================================================================

  logger.log('')
  logger.log('🔨 Socket CLI - Custom Node.js Builder')
  logger.log(`   Building Node.js ${nodeVersion} with custom patches`)
  logger.log('')

  // Initialize build log (clear previous runs to prevent log accumulation).
  await clearBuildLog(buildDir)
  await saveBuildLog(buildDir, '━'.repeat(60))
  await saveBuildLog(buildDir, '  Socket CLI - Custom Node.js Builder')
  await saveBuildLog(buildDir, `  Node.js ${nodeVersion} with custom patches`)
  await saveBuildLog(buildDir, `  Started: ${new Date().toISOString()}`)
  await saveBuildLog(buildDir, '━'.repeat(60))
  await saveBuildLog(buildDir, '')

  // Phase 1: Pre-flight checks.
  await saveBuildLog(buildDir, 'Phase 1: Pre-flight Checks')
  await checkRequiredTools({ arch, autoYes })
  await checkBuildEnvironment(buildDir)
  await saveBuildLog(buildDir, 'Pre-flight checks completed')
  await saveBuildLog(buildDir, '')

  // Ensure build directory exists.
  await safeMkdir(buildDir, { recursive: true })

  // Progressive checkpoint restoration (same as CI restore-checkpoint action).
  // Walk backward through checkpoint chain to find latest valid checkpoint.
  // This allows local builds to resume from the same point as CI builds.
  const checkpointChain = getCheckpointChain(buildMode)
  let resumeFromCheckpoint

  for (const checkpoint of checkpointChain) {
    // Check if this checkpoint exists
    const exists = await hasCheckpoint(buildDir, packageName, checkpoint)

    if (exists) {
      // Found latest checkpoint
      resumeFromCheckpoint = checkpoint
      logger.log('')
      logger.step('Progressive Checkpoint Restoration')
      logger.substep(`Found checkpoint: ${checkpoint}`)

      // If finalized, build is complete
      if (checkpoint === 'finalized') {
        logger.success('Build already complete')
        logger.log('')
        return { releaseBinaryPath: outputReleaseBinary }
      }

      logger.substep(`Build will resume from ${checkpoint} checkpoint`)
      logger.log('')
      break
    }
  }

  if (!resumeFromCheckpoint) {
    logger.log('')
    logger.step('Starting Fresh Build')
    logger.substep('No checkpoints found - building from scratch')
    logger.log('')
  }

  // Check if we can use cached build.
  if (!cleanBuild) {
    // Collect all source files.
    const sourcePaths = collectSourceFiles()

    // Check if build is needed.
    const needsRebuild = await needsCacheRebuild(cacheDir, sourcePaths)

    if (!needsRebuild && existsSync(outputReleaseBinary)) {
      // Cache hit!
      logger.log('')
      logger.success('Using cached build')
      logger.log('All source files unchanged since last build.')
      logger.log('')
      logger.substep(`Release binary: ${outputReleaseBinary}`)
      logger.log('')
      logger.success('Cached build is ready to use')
      logger.log('')
      return { releaseBinaryPath: outputReleaseBinary, cached: true }
    }
  }

  // Phase 2: Clone Node.js source to shared directory (source-cloned checkpoint).
  await cloneNodeSource({
    nodeVersion,
    nodeSha,
    nodeRepo,
    sharedBuildDir,
    sharedSourceDir,
    packageName,
    packageRoot,
    cleanBuild,
  })

  // Check if mode source needs to be reset before extraction.
  // This handles two cases:
  // 1. Source exists but needs patching (source-patched checkpoint doesn't exist)
  // 2. Source has uncommitted changes (local dev modified files)
  // In both cases, delete the directory so it will be re-extracted below.
  if (existsSync(modeSourceDir)) {
    logger.step('Checking Existing Node.js Source')

    // Check if we need to apply patches (source-patched checkpoint doesn't exist).
    const needsPatching = await shouldRun(
      buildDir,
      packageName,
      'source-patched',
      cleanBuild,
    )

    if (needsPatching) {
      logger.warn(
        'Source exists but patches need to be applied - will re-extract pristine source',
      )
      await safeDelete(modeSourceDir)
      logger.log('')
    } else {
      // Check for uncommitted changes only if we're not patching.
      const isDirty = await isNodeSourceDirty()
      if (isDirty) {
        if (!autoYes) {
          logger.warn('Node.js source has uncommitted changes')
          logger.substep(
            'These changes will be discarded to ensure a clean build',
          )
          logger.substep(
            'Press Ctrl+C now if you want to inspect the changes first',
          )
          logger.substep(
            'Or wait 5 seconds to continue with automatic reset...',
          )
          logger.logNewline()

          await new Promise(resolve => setTimeout(resolve, 5000))
          logger.log('')
        } else {
          logger.log(
            '⚠️  Node.js source has uncommitted changes (will re-extract with --yes)',
          )
          logger.log('')
        }

        await safeDelete(modeSourceDir)
      } else {
        logger.success('Source is clean and ready')
        logger.log('')
      }
    }
  }

  // Extract source to mode-specific directory (if needed).
  // Try checkpoints in order from newest to oldest (progressive restoration).
  // This matches CI behavior where restore-checkpoint action walks backward.
  if (!existsSync(modeSourceDir)) {
    logger.step(`Extracting Node.js Source to ${buildMode} Build`)
    logger.log('Looking for source checkpoints...')
    logger.log('')

    // Try source-patched first (mode-specific, already has patches applied)
    let restored = await restoreCheckpoint(
      buildDir,
      packageName,
      'source-patched',
      { destDir: buildDir },
    )

    if (restored) {
      logger.success(
        'Restored from source-patched checkpoint (patches already applied)',
      )
      logger.log('')
    } else {
      // Fall back to source-cloned (shared, pristine source)
      logger.log('source-patched not found, trying source-cloned...')
      logger.log('')

      restored = await restoreCheckpoint(
        sharedBuildDir,
        packageName,
        'source-cloned',
        { destDir: buildDir },
      )

      if (!restored) {
        printError('Source Extraction Failed', 'No source checkpoints found.', [
          'Neither source-patched nor source-cloned checkpoints exist',
          'This should not happen - source-cloned is created during clone phase',
          'Try running with --clean to re-clone from GitHub',
        ])
        throw new Error('Source extraction failed')
      }

      logger.success('Restored from source-cloned checkpoint')
      logger.log('')
    }
  }

  // Copy build additions.
  await copyBuildAdditions(modeSourceDir)

  // Phase 3: Apply Socket patches (source-patched checkpoint).
  await applySocketPatches({
    nodeVersion,
    buildDir,
    modeSourceDir,
    packageName,
    patchedFile,
    patchesReleaseDir: PATCHES_SOURCE_PATCHED_DIR,
    buildPatchesDir,
    cleanBuild,
  })

  // Verify modifications.
  await verifySocketModifications()

  // Configure Node.js.
  logger.step('Configuring Node.js Build')

  if (IS_DEV_BUILD) {
    logger.log(
      `${colors.cyan('🚀 DEV BUILD MODE')} - Fast builds, larger binaries`,
    )
    logger.log('')
    logger.log(
      'Expected binary size: ~80-90MB (before stripping), ~50-55MB (after)',
    )
    logger.log('Expected build time: ~50% faster than production builds')
  } else {
    logger.log(
      `${colors.magenta('⚡ PRODUCTION BUILD MODE')} - Optimized for size/distribution`,
    )
    logger.log('')
    logger.log(
      'Expected binary size: ~75MB (before stripping), ~60-65MB (after)',
    )
  }
  logger.log('')

  const configureFlags = [
    '--ninja',
    '--with-intl=small-icu',
    '--without-npm',
    '--without-corepack',
    '--without-amaro',
    '--without-node-options',
  ]

  // For Linux x64 builds, disable OpenSSL assembly to avoid AVX/AVX2 instructions
  // that may not be available on all x86-64 CPUs (e.g., GitHub Actions runners).
  // This ensures binary portability across different CPU generations.
  if (IS_LINUX && arch === 'x64') {
    configureFlags.push('--openssl-no-asm')
  }

  if (isProdBuild) {
    configureFlags.push('--without-inspector')
    if (IS_LINUX) {
      configureFlags.push('--enable-lto')
    }
  }

  // For musl builds, statically link libstdc++ to avoid runtime dependencies
  if (IS_MUSL) {
    configureFlags.push('--fully-static')
  }

  // Cross-compilation support (Windows only, or with --allow-cross flag).
  const hostArch = process.arch
  const isArchMismatch = arch !== hostArch
  const isCrossCompiling = isArchMismatch && (IS_WINDOWS || allowCross)
  if (isCrossCompiling) {
    if (IS_WINDOWS) {
      logger.log(`Cross-compiling for Windows ${arch} on ${hostArch} host`)
    } else {
      logger.warn(
        `Cross-compiling for ${platform} ${arch} on ${hostArch} host (experimental)`,
      )
      logger.warn(
        '   This may cause build errors. Use a native runner if possible.',
      )
    }
    configureFlags.push(`--dest-cpu=${arch}`)
  } else if (isArchMismatch) {
    logger.fail(
      `Cross-compilation not supported: building ${arch} on ${hostArch} host`,
    )
    logger.log(`   Use a native ${arch} runner or add --allow-cross flag.`)
    process.exit(1)
  }

  // Collect build source files.
  const buildSourcePaths = collectSourceFiles()

  // Check if we need to build.
  const needsBuild = await shouldRun(
    buildDir,
    packageName,
    'release',
    cleanBuild,
    buildSourcePaths,
  )

  if (needsBuild) {
    // Clean build directory.
    logger.step('Cleaning Build Directory')
    if (existsSync(outDir)) {
      logger.log(`Removing ${outDir} to prevent ninja duplicate rules...`)
      await safeDelete(outDir)
      logger.success(`Cleaned ${outDir}`)
      logger.log('')
    } else {
      logger.log('No out/ directory found (clean state)')
      logger.log('')
    }

    // Windows: Clean stale junction links.
    if (WIN32) {
      const configDirs = ['Release', 'Debug']
      for (const configDir of configDirs) {
        const junctionPath = path.join(modeSourceDir, configDir)
        if (existsSync(junctionPath)) {
          logger.log(`Removing stale ${configDir} directory/junction...`)
          await exec('cmd.exe', ['/c', `rd /S /Q "${configDir}"`], {
            cwd: modeSourceDir,
          })
          logger.log(`Removed ${configDir}`)
        }
      }
    }

    // Configure.
    const configureCommand = WIN32 ? 'vcbuild.bat' : './configure'
    const configureArgs = WIN32
      ? convertToVcbuildFlags(configureFlags)
      : configureFlags

    logger.log(`::group::Running ${WIN32 ? 'vcbuild.bat' : './configure'}`)

    await exec(configureCommand, configureArgs, {
      cwd: modeSourceDir,
      shell: WIN32,
    })
    logger.log('::endgroup::')
    logger.log(
      `${colors.green('✓')} ${WIN32 ? 'Build' : 'Configuration'} complete`,
    )
    logger.log('')

    if (WIN32) {
      logger.success('Windows build completed by vcbuild.bat')
      logger.log('')
    } else {
      logger.step('Building Node.js')
    }
  }

  // Compile (Unix only, Windows already done).
  if (!needsBuild) {
    logger.log('')
  } else if (!WIN32) {
    const jobCount = CPU_COUNT
    const timeEstimate = estimateBuildTime(jobCount)

    const totalCpus = cpus().length
    const totalRamGB = Math.floor(totalmem() / (1024 * 1024 * 1024))
    const isMemoryConstrained = jobCount < totalCpus
    const isEnvOverride = !!process.env.NODE_BUILD_JOBS

    logger.log(
      `⏱️  Estimated time: ${timeEstimate.estimatedMinutes} minutes (${timeEstimate.minMinutes}-${timeEstimate.maxMinutes} min range)`,
    )

    if (isEnvOverride) {
      logger.log(
        `🚀 Using ${jobCount} CPU core${jobCount > 1 ? 's' : ''} for parallel compilation (NODE_BUILD_JOBS override)`,
      )
    } else if (isMemoryConstrained) {
      logger.log(
        `🚀 Using ${jobCount} CPU core${jobCount > 1 ? 's' : ''} for parallel compilation (${totalCpus} CPUs available, reduced for ${totalRamGB}GB RAM)`,
      )
      logger.log(
        '   Memory-optimized build to prevent resource exhaustion (each job uses ~400-800MB RAM)',
      )
    } else {
      logger.log(
        `🚀 Using ${jobCount} CPU core${jobCount > 1 ? 's' : ''} for parallel compilation`,
      )
    }
    logger.log('')
    logger.log('Starting build...')
    logger.log('')

    // Clean macOS AppleDouble files that may have been restored from checkpoints
    // These ._* files cause ninja to fail trying to compile binary metadata as C++
    if (platform !== 'darwin') {
      try {
        const findResult = await spawn(
          'find',
          [modeSourceDir, '-name', '._*', '-type', 'f', '-delete'],
          { stdio: 'pipe' },
        )
        if (findResult.code === 0) {
          logger.log('Cleaned macOS AppleDouble files from source tree')
        }
      } catch {
        // find not available or failed - non-fatal, build may still succeed
      }
    }

    const buildStart = Date.now()

    logger.log(
      '::group::Compiling Node.js with Ninja (this will take a while...)',
    )

    try {
      const ninjaCommand = whichSync('ninja')
      await exec(ninjaCommand, ['-C', 'out/Release', `-j${CPU_COUNT}`], {
        cwd: modeSourceDir,
        env: process.env,
      })
      logger.log('::endgroup::')
    } catch (e) {
      logger.log('::endgroup::')
      logger.log('')
      logger.log('::error::Ninja build failed - see collapsed section above')
      logger.log('')

      const lastLines = await getLastLogLines(buildDir, 100)
      if (lastLines) {
        logger.error()
        logger.error('Last 100 lines of build log:')
        logger.error('━'.repeat(60))
        logger.error(lastLines)
        logger.error('━'.repeat(60))
      }

      printError(
        'Build Failed',
        'Node.js compilation failed. See build log for details.',
        [
          `Full log: ${getBuildLogPath(buildDir)}`,
          'Try again with: pnpm build --clean',
        ],
      )
      throw e
    }

    const buildDuration = Date.now() - buildStart
    const buildTime = formatDuration(buildDuration)

    logger.log('')
    logger.success(`Build completed in ${buildTime}`)
    logger.log('')
  }

  // Test binary.
  // Will automatically fall back to static verification if cross-compiled.
  logger.step('Testing Binary (Release)')

  logger.log('Running comprehensive functionality tests...')
  logger.log('')

  const smokeTestPassed = await smokeTestBinary(
    nodeBinary,
    isCrossCompiling ? { arch } : {},
  )

  if (!smokeTestPassed) {
    printError(
      'Binary Failed Smoke Tests',
      'Binary failed comprehensive smoke tests after build',
      [
        'Build may have produced corrupted binary',
        'Try rebuilding: pnpm build --clean',
        'Report this issue if it persists',
      ],
    )
    throw new Error('Binary failed smoke tests')
  }

  logger.log('')
  logger.success('Binary is functional')
  logger.log('')

  // Copy to Release output.
  logger.step('Copying to Build Output (Release)')
  logger.log('Copying unmodified binary to Release directory...')
  logger.logNewline()

  await safeMkdir(outputReleaseDir)
  await fs.cp(nodeBinary, outputReleaseBinary, {
    force: true,
    preserveTimestamps: true,
  })

  logger.substep(`Release directory: ${outputReleaseDir}`)
  logger.substep('Binary: node (unmodified)')
  logger.logNewline()
  logger.success(`Unmodified binary copied to ${outputReleaseDir}`)
  logger.logNewline()

  // Clean Release directory before checkpoint to ensure only the release binary is archived
  // This removes any leftover files from previous builds
  if (!skipCheckpoint) {
    logger.substep('Cleaning checkpoint directory...')
    const releaseDirFiles = await fs.readdir(outputReleaseDir)
    const releaseBinaryName = path.basename(outputReleaseBinary)
    for (const file of releaseDirFiles) {
      if (file !== releaseBinaryName) {
        const filePath = path.join(outputReleaseDir, file)
        await safeDelete(filePath)
        logger.substep(`Removed: ${file}`)
      }
    }
    logger.logNewline()

    // Create Release checkpoint.
    const releaseBinarySize = await getFileSize(outputReleaseBinary)
    await createCheckpoint(
      buildDir,
      'binary-released',
      async () => {
        // Use smokeTestBinary with automatic fallback for cross-compiled builds
        const validated = await smokeTestBinary(
          outputReleaseBinary,
          isCrossCompiling ? { arch } : {},
        )
        if (!validated) {
          throw new Error('Binary validation failed')
        }
        logger.substep('Binary validated')
      },
      {
        packageName,
        binarySize: releaseBinarySize,
        artifactPath: outputReleaseDir,
        sourcePaths: buildSourcePaths,
        packageRoot,
        platform,
        arch,
      },
    )
    logger.log('')
  }

  return {
    releaseBinaryPath: outputReleaseBinary,
    buildSourcePaths,
    isCrossCompiling,
  }
}
