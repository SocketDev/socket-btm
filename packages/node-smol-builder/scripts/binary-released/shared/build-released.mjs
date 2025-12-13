#!/usr/bin/env node
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
  checkCompiler,
  checkDiskSpace,
  checkNetworkConnectivity,
  checkPythonVersion,
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
import {
  ensureGccVersion,
  getGccInstructions,
} from 'build-infra/lib/compiler-installer'
import { nodeVersionRaw } from 'build-infra/lib/node-version'
import {
  ensureAllToolsInstalled,
  ensurePackageManagerAvailable,
  getInstallInstructions,
  getPackageManagerInstructions,
} from 'build-infra/lib/tool-installer'
import colors from 'yoctocolors-cjs'

import { which, whichSync } from '@socketsecurity/lib/bin'
import { WIN32 } from '@socketsecurity/lib/constants/platform'
import { safeDelete, safeMkdir } from '@socketsecurity/lib/fs'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

import {
  ADDITIONS_MAPPINGS,
  BINFLATE_DIR,
  BINPRESS_DIR,
  PATCHES_SOURCE_PATCHED_DIR,
} from './paths.mjs'
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
export async function buildRelease(options) {
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
  } = options

  const IS_MACOS = platform === 'darwin'
  const IS_WINDOWS = platform === 'win32'
  const IS_LINUX = platform === 'linux' || platform === 'linux-musl'
  const IS_DEV_BUILD = !isProdBuild

  /**
   * Collect build source files for cache validation.
   */
  function collectSourceFiles() {
    return collectBuildSourceFiles()
  }

  /**
   * Copy build additions to Node.js source tree.
   */
  async function copyBuildAdditions() {
    logger.step('Copying Build Additions')

    for (const { dest, source } of ADDITIONS_MAPPINGS) {
      if (!existsSync(source)) {
        logger.skip(`Source directory not found: ${source}`)
        continue
      }

      const destDir = path.join(modeSourceDir, dest)
      await safeMkdir(destDir)

      // Copy all files from source to destination.
      const files = await fs.readdir(source)
      for (const file of files) {
        const sourcePath = path.join(source, file)
        const destPath = path.join(destDir, file)
        await fs.copyFile(sourcePath, destPath)
      }

      logger.success(`Copied ${files.length} file(s) to ${dest}/`)
    }

    logger.log('')
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
   * Check if required tools are available.
   */
  async function checkRequiredTools() {
    logger.step('Pre-flight Checks')

    // Step 1: Ensure package manager is available.
    const pmResult = await ensurePackageManagerAvailable({
      autoInstall: autoYes,
      autoYes,
    })

    const canAutoInstall = pmResult.available

    if (pmResult.installed) {
      logger.success(
        `Package manager (${pmResult.manager}) installed successfully`,
      )
    } else if (pmResult.available) {
      logger.log(`📦 Package manager detected: ${pmResult.manager}`)
    } else {
      logger.warn('No package manager available for auto-installing tools')
      const pmInstructions = getPackageManagerInstructions()
      for (const instruction of pmInstructions) {
        logger.substep(instruction)
      }
    }

    // Step 2: Tools that support auto-installation.
    const autoInstallableTools = ['git', 'curl', 'patch', 'make']

    // Step 3: Tools that must be checked manually.
    const manualTools = [{ name: 'strip', cmd: 'strip', checkExists: true }]

    if (IS_MACOS && arch === 'arm64') {
      manualTools.push({
        name: 'codesign',
        cmd: 'codesign',
        checkExists: true,
      })
    }

    // Step 4: Attempt auto-installation for missing tools.
    const result = await ensureAllToolsInstalled(autoInstallableTools, {
      autoInstall: canAutoInstall,
      autoYes,
    })

    // Step 5: Report results.
    for (const tool of autoInstallableTools) {
      if (result.installed.includes(tool)) {
        logger.success(`${tool} installed automatically`)
      } else if (!result.missing.includes(tool)) {
        logger.success(`${tool} is available`)
      }
    }

    // Step 6: Check manual tools.
    let allManualAvailable = true
    for (const { cmd, name } of manualTools) {
      const binPath = whichSync(cmd, { nothrow: true })
      if (binPath) {
        logger.success(`${name} is available`)
      } else {
        logger.fail(`${name} is NOT available`)
        allManualAvailable = false
      }
    }

    // Step 7: Handle missing tools.
    if (!result.allAvailable || !allManualAvailable) {
      const missingTools = [
        ...result.missing,
        ...manualTools
          .filter(t => !whichSync(t.cmd, { nothrow: true }))
          .map(t => t.name),
      ]

      if (missingTools.length > 0) {
        const instructions = []
        instructions.push('Missing required build tools:')
        instructions.push('')

        for (const tool of missingTools) {
          const toolInstructions = getInstallInstructions(tool)
          instructions.push(...toolInstructions)
          instructions.push('')
        }

        if (IS_MACOS) {
          instructions.push('For Xcode Command Line Tools:')
          instructions.push('  xcode-select --install')
        }

        printError(
          'Missing Required Tools',
          'Some required build tools are not available.',
          instructions,
        )
        throw new Error('Missing required build tools')
      }
    }

    logger.log('')
  }

  /**
   * Check build environment.
   */
  async function checkBuildEnvironment() {
    logger.step('Build Environment Checks')

    let allChecks = true

    // Check 1: Disk space.
    logger.log('Checking available disk space...')
    const diskSpace = await checkDiskSpace(buildDir)
    if (diskSpace.availableGB !== null) {
      if (diskSpace.sufficient) {
        logger.success(
          `Disk space: ${diskSpace.availableGB}GB available (need 5GB)`,
        )
      } else {
        logger.fail(
          `Disk space: Only ${diskSpace.availableGB}GB available (need 5GB)`,
        )
        logger.substep('Free up disk space before building')
        allChecks = false
      }
    } else {
      logger.warn('Could not check disk space (continuing anyway)')
    }

    // Check 2: Python version.
    logger.log('Checking Python version...')
    const python = await checkPythonVersion()
    if (python.available && python.sufficient) {
      logger.success(`Python ${python.version} is available`)
    } else if (python.available && !python.sufficient) {
      logger.fail(`Python ${python.version} is too old (need Python 3.6+)`)
      allChecks = false
    } else {
      logger.fail('Python is not available')
      logger.substep('Node.js build requires Python 3.6 or later')
      allChecks = false
    }

    // Check 3: C++ compiler.
    logger.log('Checking C++ compiler...')
    const compiler = await checkCompiler()
    if (compiler.available) {
      logger.success(`C++ compiler (${compiler.compiler}) is available`)
    } else {
      logger.fail('C++ compiler is not available')
      logger.substep('Node.js build requires clang++, g++, or c++')
      allChecks = false
    }

    // Check 3b: GCC version (Linux only).
    if (process.platform === 'linux' && compiler.compiler === 'g++') {
      logger.log('Checking GCC version...')
      const gccCheck = await ensureGccVersion({
        autoInstall: true,
        quiet: false,
      })
      if (gccCheck.available) {
        logger.success(`GCC ${gccCheck.version} meets requirements`)
      } else {
        logger.fail('GCC version does not meet requirements')
        logger.substep('Node.js v24 requires GCC 12.2+ for C++20 support')
        const instructions = getGccInstructions()
        instructions.forEach(line => logger.substep(line))
        allChecks = false
      }
    }

    // Check 3c: Xcode version (macOS only).
    if (process.platform === 'darwin') {
      logger.log('Checking Xcode version...')
      try {
        const result = await exec('xcodebuild', ['-version'], {
          encoding: 'utf8',
          shell: false,
        })
        const match = result.stdout?.match(/Xcode (\d+\.\d+)/)
        if (match) {
          const version = match[1]
          const majorVersion = Number.parseInt(version.split('.')[0], 10)
          if (majorVersion >= 16) {
            logger.success(`Xcode ${version} meets requirements (clang 19+)`)
          } else {
            logger.fail(`Xcode ${version} is too old (need Xcode 16+)`)
            logger.substep(
              'Node.js v24 requires Xcode 16+ with clang 19+ for C++20 support',
            )
            logger.substep(
              'Older clang versions crash on large V8 files with -O3 optimization',
            )
            logger.substep(
              'Install Xcode 16.1+ from: https://developer.apple.com/xcode/',
            )
            logger.substep(
              'After install, run: sudo xcode-select --switch /Applications/Xcode.app/Contents/Developer',
            )
            allChecks = false
          }
        } else {
          logger.warn('Could not parse Xcode version (continuing anyway)')
        }
      } catch {
        logger.warn('Could not check Xcode version (continuing anyway)')
      }
    }

    // Check 4: Network connectivity.
    logger.log('Checking network connectivity...')
    const network = await checkNetworkConnectivity()
    if (network.connected) {
      logger.success('Network connection to GitHub is working')
    } else {
      logger.fail('Cannot reach GitHub')
      logger.substep('Check your internet connection')
      allChecks = false
    }

    logger.logNewline()

    if (!allChecks) {
      printError(
        'Build Environment Not Ready',
        'Some required build environment checks failed.',
        [
          'Fix the issues above before building',
          'Disk space: Free up space if needed',
          'Python: Install Python 3.6+ (python.org or brew install python)',
          'Compiler: Install Xcode Command Line Tools (xcode-select --install)',
          'Network: Check your internet connection',
        ],
      )
      throw new Error('Build environment checks failed')
    }

    logger.success('Build environment is ready')
    logger.logNewline()
  }

  /**
   * Check for and build compression tools.
   */
  async function ensureCompressionTools() {
    logger.step('Checking Compression Tools')

    const currentPlatform = process.platform

    let decompressorBinary
    let compressorBinary
    let makefile

    // Select platform-specific Makefile
    if (currentPlatform === 'linux') {
      decompressorBinary = 'binflate'
      compressorBinary = 'binpress'
      makefile = 'Makefile.linux'
    } else if (currentPlatform === 'win32') {
      decompressorBinary = 'binflate.exe'
      compressorBinary = 'binpress.exe'
      makefile = 'Makefile.windows'
    } else if (currentPlatform === 'darwin') {
      decompressorBinary = 'binflate'
      compressorBinary = 'binpress'
      makefile = 'Makefile'
    } else {
      logger.warn(
        `Unknown platform: ${currentPlatform}, skipping compression tools`,
      )
      return
    }

    const decompressorPath = path.join(BINFLATE_DIR, 'out', decompressorBinary)
    const compressorPath = path.join(BINPRESS_DIR, 'out', compressorBinary)

    // Check if tools already exist
    const decompressorExists = existsSync(decompressorPath)
    const compressorExists = existsSync(compressorPath)

    if (decompressorExists && compressorExists) {
      logger.success(`Compression tools already built (${currentPlatform})`)
      logger.substep(`Compressor: ${compressorBinary}`)
      logger.substep(`Decompressor: ${decompressorBinary}`)
      logger.logNewline()
      return
    }

    logger.log(`Building compression tools for ${currentPlatform}...`)
    logger.substep(`Makefile: ${makefile}`)

    // Install dependencies if needed (Linux only)
    if (currentPlatform === 'linux') {
      logger.log('Checking for liblzma development headers...')

      try {
        await exec('pkg-config', ['--exists', 'liblzma'], {
          shell: WIN32,
          encoding: 'utf8',
        })
        logger.success('liblzma development headers are installed')
      } catch {
        logger.warn('liblzma development headers not found')
        logger.substep('Install with: sudo apt-get install liblzma-dev=5.2.5-*')
        logger.substep('Or: sudo yum install xz-devel')
        logger.substep('Or: sudo apk add xz-dev')
        logger.warn('Continuing anyway - build may fail if headers are missing')
      }
    }

    // Build compression tools - each package has its own Makefile
    logger.log('')
    try {
      const makeCommand = currentPlatform === 'win32' ? 'mingw32-make' : 'make'

      // Build binpress (compressor)
      if (!compressorExists) {
        logger.log('Building binpress (compressor)...')
        await exec(makeCommand, ['-f', makefile], {
          cwd: BINPRESS_DIR,
          shell: WIN32,
          stdio: 'inherit',
        })
      }

      // Build binflate (decompressor)
      if (!decompressorExists) {
        logger.log('Building binflate (decompressor)...')
        await exec(makeCommand, ['-f', makefile], {
          cwd: BINFLATE_DIR,
          shell: WIN32,
          stdio: 'inherit',
        })
      }

      logger.log('')
      logger.success('Compression tools built successfully')
      logger.substep(`Compressor: ${compressorPath}`)
      logger.substep(`Decompressor: ${decompressorPath}`)
    } catch {
      printError(
        'Compression Tools Build Failed',
        'Failed to build compression tools.',
        [
          'Ensure development tools are installed:',
          '  Linux: gcc, make, liblzma-dev',
          '  macOS: Xcode Command Line Tools',
          '  Windows: MinGW with gcc and make',
          '',
          'Or build manually:',
          `  cd packages/binpress && make -f ${makefile}`,
          `  cd packages/binflate && make -f ${makefile}`,
        ],
      )
      throw new Error('Compression tools build failed')
    }

    logger.logNewline()
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
    logger.log('Checking polyfill in bootstrap/node.js...')
    try {
      const content = await fs.readFile(bootstrapFile, 'utf8')
      const hasLocaleCompare = content.includes(
        'Socket CLI: Polyfill localeCompare',
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

  // Initialize build log.
  await saveBuildLog(buildDir, '━'.repeat(60))
  await saveBuildLog(buildDir, '  Socket CLI - Custom Node.js Builder')
  await saveBuildLog(buildDir, `  Node.js ${nodeVersion} with custom patches`)
  await saveBuildLog(buildDir, `  Started: ${new Date().toISOString()}`)
  await saveBuildLog(buildDir, '━'.repeat(60))
  await saveBuildLog(buildDir, '')

  // Phase 1: Pre-flight checks.
  await saveBuildLog(buildDir, 'Phase 1: Pre-flight Checks')
  await checkRequiredTools()
  await checkBuildEnvironment()
  await ensureCompressionTools()
  await saveBuildLog(buildDir, 'Pre-flight checks completed')
  await saveBuildLog(buildDir, '')

  // Ensure build directory exists.
  await safeMkdir(buildDir, { recursive: true })

  // Progressive checkpoint restoration (same as CI restore-checkpoint action).
  // Walk backward through checkpoint chain to find latest valid checkpoint.
  // This allows local builds to resume from the same point as CI builds.
  const checkpointChain = getCheckpointChain(buildMode)
  let resumeFromCheckpoint = null

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
  await copyBuildAdditions()

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

  if (isProdBuild) {
    configureFlags.push('--without-inspector')
    if (IS_LINUX) {
      configureFlags.push('--enable-lto')
    }
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

  const smokeTestPassed = await smokeTestBinary(nodeBinary, null, {
    expectedArch: isCrossCompiling ? arch : undefined,
  })

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
  logger.log('Copying unmodified binary to build/out/Release directory...')
  logger.logNewline()

  await safeMkdir(outputReleaseDir)
  await fs.cp(nodeBinary, outputReleaseBinary, {
    force: true,
    preserveTimestamps: true,
  })

  logger.substep(`Release directory: ${outputReleaseDir}`)
  logger.substep('Binary: node (unmodified)')
  logger.logNewline()
  logger.success('Unmodified binary copied to build/out/Release')
  logger.logNewline()

  // Clean Release directory before checkpoint to ensure only the release binary is archived
  // This removes any leftover files from previous builds
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
      const validated = await smokeTestBinary(outputReleaseBinary, null, {
        expectedArch: isCrossCompiling ? arch : undefined,
      })
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

  return {
    releaseBinaryPath: outputReleaseBinary,
    buildSourcePaths,
    isCrossCompiling,
  }
}
