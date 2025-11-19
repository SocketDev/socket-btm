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

import { existsSync, readdirSync, promises as fs } from 'node:fs'
import { cpus, totalmem } from 'node:os'
import path from 'node:path'

import {
  checkCompiler,
  checkDiskSpace,
  checkNetworkConnectivity,
  checkPythonVersion,
  cleanCheckpoint,
  createCheckpoint,
  estimateBuildTime,
  exec,
  formatDuration,
  getBuildLogPath,
  getFileSize,
  getLastLogLines,
  needsCacheRebuild,
  saveBuildLog,
} from 'build-infra/lib/build-helpers'
import { printError } from 'build-infra/lib/build-output'
import {
  getCheckpointData,
  restoreCheckpoint,
  shouldRun,
} from 'build-infra/lib/checkpoint-manager'
import {
  ensureGccVersion,
  getGccInstructions,
} from 'build-infra/lib/compiler-installer'
import {
  analyzePatchContent,
  checkPatchConflicts,
  validatePatch,
} from 'build-infra/lib/patch-validator'
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
  COMPRESSION_TOOLS_DIR,
  PATCHES_RELEASE_DIR,
} from '../../paths.mjs'

const logger = getDefaultLogger()

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
 * @param {function} options.collectBuildSourceFiles - Function to collect build source files
 * @param {string} options.packageRoot - Package root directory
 */
export async function buildRelease(options) {
  const {
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
   * Find Socket patches for this Node version.
   */
  function findSocketPatches() {
    const patches = []

    // Get static patches from patches/ directory.
    if (existsSync(PATCHES_RELEASE_DIR)) {
      const staticPatches = readdirSync(PATCHES_RELEASE_DIR)
        .filter(f => f.endsWith('.patch') && !f.endsWith('.template.patch'))
        .map(f => ({
          name: f,
          path: path.join(PATCHES_RELEASE_DIR, f),
          source: 'patches/',
        }))
      patches.push(...staticPatches)
    }

    // Get dynamic patches from build/patches/ directory.
    if (existsSync(buildPatchesDir)) {
      const dynamicPatches = readdirSync(buildPatchesDir)
        .filter(f => f.endsWith('.patch'))
        .map(f => ({
          name: f,
          path: path.join(buildPatchesDir, f),
          source: 'build/patches/',
        }))
      patches.push(...dynamicPatches)
    }

    // Sort by name for consistent ordering.
    patches.sort((a, b) => a.name.localeCompare(b.name))

    if (patches.length > 0) {
      logger.log(`   Found ${patches.length} patch file(s):`)
      for (const patch of patches) {
        logger.log(`     → ${patch.name} (${patch.source})`)
      }
    }

    return patches
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

      logger.log(`✅ Copied ${files.length} file(s) to ${dest}/`)
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
   * Reset Node.js source to pristine state.
   */
  async function resetNodeSource() {
    logger.log('Fetching latest tags...')
    await exec(
      'git',
      [
        'fetch',
        '--depth',
        '1',
        'origin',
        `refs/tags/${nodeVersion}:refs/tags/${nodeVersion}`,
      ],
      {
        cwd: modeSourceDir,
      },
    )
    logger.log('Resetting to clean state...')
    await exec('git', ['reset', '--hard', nodeVersion], { cwd: modeSourceDir })
    await exec('git', ['clean', '-fdx'], { cwd: modeSourceDir })
    logger.log(`${colors.green('✓')} Node.js source reset to clean state`)
    logger.log('')
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
        logger.log(`${colors.green('✓')} ${tool} is available`)
      }
    }

    // Step 6: Check manual tools.
    let allManualAvailable = true
    for (const { cmd, name } of manualTools) {
      const binPath = whichSync(cmd, { nothrow: true })
      if (binPath) {
        logger.log(`${colors.green('✓')} ${name} is available`)
      } else {
        logger.error(`${colors.red('✗')} ${name} is NOT available`)
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

    const toolsDir = COMPRESSION_TOOLS_DIR
    const currentPlatform = process.platform

    let decompressorBinary
    let compressorBinary
    let makefile

    if (currentPlatform === 'linux') {
      decompressorBinary = 'socketsecurity_elf_decompress'
      compressorBinary = 'socketsecurity_elf_compress'
      makefile = 'Makefile.linux'
    } else if (currentPlatform === 'win32') {
      decompressorBinary = 'socketsecurity_pe_decompress.exe'
      compressorBinary = 'socketsecurity_pe_compress.exe'
      makefile = 'Makefile.windows'
    } else if (currentPlatform === 'darwin') {
      decompressorBinary = 'socketsecurity_macho_decompress'
      compressorBinary = 'socketsecurity_macho_compress'
      makefile = 'Makefile'
    } else {
      logger.warn(
        `Unknown platform: ${currentPlatform}, skipping compression tools`,
      )
      return
    }

    const decompressorPath = path.join(toolsDir, decompressorBinary)
    const compressorPath = path.join(toolsDir, compressorBinary)

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

    // Build compression tools
    logger.log('')
    try {
      const makeCommand = currentPlatform === 'win32' ? 'mingw32-make' : 'make'

      await exec(makeCommand, ['-f', makefile], {
        cwd: toolsDir,
        shell: WIN32,
        stdio: 'inherit',
      })

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
          `  cd ${toolsDir}`,
          `  make -f ${makefile}`,
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
          'V8 include paths are correct (no modification needed for v24.10.0+)',
        )
      } else if (content.includes('#include "base/iterator.h"')) {
        logger.fail('V8 include paths were incorrectly modified!')
        logger.substep('v24.10.0+ needs "src/" prefix in includes')
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

  // Check if build is already complete.
  if (!(await shouldRun(buildDir, packageName, 'complete', cleanBuild))) {
    logger.log('')
    logger.success('Build already complete')
    logger.log('')
    return { releaseBinaryPath: outputReleaseBinary }
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

  // Phase 2: Clone or reset Node.js repository.
  const needsClone = await shouldRun(
    sharedBuildDir,
    packageName,
    'source-cloned',
    cleanBuild,
  )

  // Check Node version mismatch.
  let versionMismatch = false
  if (!needsClone) {
    const checkpointData = await getCheckpointData(
      sharedBuildDir,
      packageName,
      'source-cloned',
    )
    if (checkpointData && checkpointData.nodeVersion !== nodeVersion) {
      logger.log(
        `Node version changed from ${checkpointData.nodeVersion} to ${nodeVersion}, re-cloning...`,
      )
      versionMismatch = true
    } else if (checkpointData && checkpointData.nodeSha !== nodeSha) {
      logger.log(
        `Node SHA changed from ${checkpointData.nodeSha?.slice(0, 8)} to ${nodeSha.slice(0, 8)}, re-cloning...`,
      )
      versionMismatch = true
    }
  }

  if (!needsClone && !versionMismatch) {
    logger.log('')
  } else if (!existsSync(sharedSourceDir) || cleanBuild || versionMismatch) {
    if (existsSync(sharedSourceDir) && (cleanBuild || versionMismatch)) {
      logger.step('Clean Build Requested')
      logger.log('Removing existing shared Node.js source directory...')
      await safeDelete(sharedSourceDir, { recursive: true, force: true })
      await cleanCheckpoint(sharedBuildDir, packageName)
      logger.success('Cleaned shared source directory')
      logger.log('')
    }

    logger.step('Cloning Node.js Source')
    logger.log(`Version: ${nodeVersion} (${nodeSha.slice(0, 8)})`)
    logger.log(`Repository: ${nodeRepo}`)
    logger.log('')
    logger.info(
      'This will download ~200-300 MB (shallow clone with --depth=1 --single-branch)...',
    )
    logger.log('Retry: Up to 3 attempts if clone fails')
    logger.log('')

    // Git clone with retry.
    let cloneSuccess = false
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        if (attempt > 1) {
          logger.log(`Retry attempt ${attempt}/3...`)
          logger.log('')
        }

        await exec(
          'git',
          [
            'clone',
            '--depth',
            '1',
            '--single-branch',
            '--branch',
            nodeVersion,
            nodeRepo,
            sharedSourceDir,
          ],
          { cwd: packageRoot },
        )
        cloneSuccess = true
        break
      } catch (e) {
        if (attempt === 3) {
          printError(
            'Git Clone Failed',
            `Failed to clone Node.js repository after 3 attempts: ${e.message}`,
            [
              'Check your internet connection',
              'Try again in a few minutes',
              'Manually clone:',
              `  cd ${packageRoot}`,
              `  git clone --depth 1 --branch ${nodeVersion} ${nodeRepo} ${sharedSourceDir}`,
            ],
          )
          throw new Error('Git clone failed after retries')
        }

        logger.warn(
          `${colors.yellow('⚠')} Clone attempt ${attempt} failed: ${e.message}`,
        )

        // Clean up partial clone.
        try {
          await safeDelete(sharedSourceDir, {
            recursive: true,
            force: true,
          })
        } catch {
          // Ignore cleanup errors.
        }

        // Wait before retry.
        const waitTime = 2000 * attempt
        logger.log(`${colors.blue('ℹ')} Waiting ${waitTime}ms before retry...`)
        logger.log('')
        await new Promise(resolve => setTimeout(resolve, waitTime))
      }
    }

    if (cloneSuccess) {
      logger.success('Node.js source cloned successfully')

      // Verify the cloned commit matches the expected SHA.
      logger.log('Verifying commit SHA...')
      const verifyResult = await spawn('git', [
        '-C',
        sharedSourceDir,
        'rev-parse',
        'HEAD',
      ])

      if (verifyResult.code !== 0) {
        throw new Error('Failed to verify cloned commit SHA')
      }

      const clonedSha = verifyResult.stdout.toString().trim()
      if (clonedSha !== nodeSha) {
        throw new Error(
          `SHA mismatch: expected ${nodeSha}, got ${clonedSha}. ` +
            `The tag ${nodeVersion} may have been updated. Please update sources.node.ref in package.json.`,
        )
      }

      logger.success(`Commit SHA verified (${nodeSha.slice(0, 8)})`)
      logger.log('Creating shared checkpoint (pristine source for dev/prod)...')
      await createCheckpoint(
        sharedBuildDir,
        packageName,
        'source-cloned',
        async () => {
          const configureScript = path.join(sharedSourceDir, 'configure')
          await fs.access(configureScript)
          logger.substep('Source directory validated')
        },
        {
          nodeVersion,
          nodeSha,
          artifactPath: sharedSourceDir,
        },
      )
      logger.log('')
    }
  }

  // Extract source to mode-specific directory.
  if (!existsSync(modeSourceDir)) {
    logger.step(`Extracting Node.js Source to ${buildMode} Build`)
    logger.log(`Extracting from shared checkpoint to ${buildMode}/source...`)
    logger.log('')

    const restored = await restoreCheckpoint(
      sharedBuildDir,
      packageName,
      'source-cloned',
      { destDir: buildDir },
    )

    if (!restored) {
      printError(
        'Source Extraction Failed',
        'Shared checkpoint not found or could not be restored.',
        [
          'The shared checkpoint may be missing or corrupted',
          'Expected checkpoint: source-cloned',
          'Try running with --clean to re-clone from GitHub',
        ],
      )
      throw new Error('Source extraction failed')
    }

    logger.success(`Source extracted to ${buildMode}/source`)
    logger.log('')
  } else {
    logger.step('Using Existing Node.js Source')

    // Check for uncommitted changes.
    const isDirty = await isNodeSourceDirty()
    if (isDirty && !autoYes) {
      logger.warn('Node.js source has uncommitted changes')
      logger.substep('These changes will be discarded to ensure a clean build')
      logger.substep(
        'Press Ctrl+C now if you want to inspect the changes first',
      )
      logger.substep('Or wait 5 seconds to continue with automatic reset...')
      logger.logNewline()

      await new Promise(resolve => setTimeout(resolve, 5000))
      logger.log('')
    } else if (isDirty && autoYes) {
      logger.log(
        '⚠️  Node.js source has uncommitted changes (auto-resetting with --yes)',
      )
      logger.log('')
    }

    await resetNodeSource()
  }

  // Copy build additions.
  await copyBuildAdditions()

  // Apply Socket patches.
  const socketPatches = findSocketPatches()
  const patchFilePaths = socketPatches.map(p => p.path)

  if (
    !(await shouldRun(
      buildDir,
      packageName,
      'patches-applied',
      cleanBuild,
      patchFilePaths,
    ))
  ) {
    logger.skip('Socket patches already applied, skipping')
    logger.log('')
  } else if (socketPatches.length > 0) {
    // Validate patches.
    logger.step('Validating Socket Patches')
    logger.log(`Found ${socketPatches.length} patch(es) for ${nodeVersion}`)
    logger.log('Checking integrity, compatibility, and conflicts...')
    logger.log('')

    const patchData = []
    let allValid = true

    for (const patch of socketPatches) {
      logger.group(` ${colors.blue('ℹ')}   Validating ${patch.name}`)

      const isValid = await validatePatch(patch.path, modeSourceDir)
      if (!isValid) {
        logger.error(`${colors.red('✗')} INVALID: Patch validation failed`)
        logger.groupEnd()
        allValid = false
        continue
      }

      const content = await fs.readFile(patch.path, 'utf8')
      const analysis = analyzePatchContent(content)

      patchData.push({
        analysis,
        content,
        name: patch.name,
        path: patch.path,
      })
      if (analysis.modifiesV8Includes) {
        logger.log(`${colors.green('✓')} Modifies V8 includes`)
      }
      if (analysis.modifiesSEA) {
        logger.log(`${colors.green('✓')} Modifies SEA detection`)
      }
      logger.log(`${colors.green('✓')} Valid`)
      logger.groupEnd()
    }

    if (!allValid) {
      throw new Error(
        'Socket patch validation failed.\n\n' +
          `One or more Socket patches are invalid or incompatible with Node.js ${nodeVersion}.\n\n` +
          'To fix:\n' +
          `  1. Verify patch files in ${PATCHES_RELEASE_DIR}\n` +
          '  2. Check build/patches/README.md for guidance',
      )
    }

    // Check for conflicts.
    const conflicts = checkPatchConflicts(patchData)
    if (conflicts.length > 0) {
      logger.warn(`${colors.yellow('⚠')} Patch Conflicts Detected:`)
      logger.warn()
      for (const conflict of conflicts) {
        if (conflict.severity === 'error') {
          logger.error(`  ${colors.red('✗')} ERROR: ${conflict.message}`)
          allValid = false
        } else {
          logger.warn(`  ${colors.yellow('⚠')} WARNING: ${conflict.message}`)
        }
      }
      logger.warn()

      if (!allValid) {
        throw new Error(
          'Critical patch conflicts detected.\n\n' +
            'Conflicts found:\n' +
            conflicts
              .filter(c => c.severity === 'error')
              .map(c => `  - ${c.message}`)
              .join('\n'),
        )
      }
    } else {
      logger.log(
        `${colors.green('✓')} All Socket patches validated successfully`,
      )
      logger.log(`${colors.green('✓')} No conflicts detected`)
      logger.log('')
    }

    // Apply patches.
    if (allValid) {
      logger.step('Applying Socket Patches')
      for (const { name, path: patchPath } of patchData) {
        logger.log(`Applying ${name}...`)

        let result
        try {
          result = await spawn(
            'sh',
            ['-c', `patch -p1 --batch --forward < "${patchPath}"`],
            {
              cwd: modeSourceDir,
            },
          )
        } catch (e) {
          result = e
        }

        if (result.code !== 0) {
          const stdout = (result.stdout ?? '').toString()
          const stderr = (result.stderr ?? '').toString()
          const output = stdout + stderr
          const isAlreadyApplied =
            output.includes('Ignoring previously applied') ||
            output.includes('Reversed (or previously applied) patch detected')

          if (isAlreadyApplied) {
            logger.skip(`${name} already applied, skipping`)
            continue
          }

          throw new Error(
            'Socket patch application failed.\n\n' +
              `Failed to apply patch: ${name}\n` +
              `Output:\n${output}`,
          )
        }

        logger.log(`${colors.green('✓')} ${name} applied`)
      }
      logger.log(`${colors.green('✓')} All Socket patches applied successfully`)
      await createCheckpoint(
        buildDir,
        packageName,
        'patches-applied',
        async () => {
          await fs.access(patchedFile)
          logger.substep('Patches verified')
        },
        {
          patchCount: socketPatches.length,
          sourcePaths: patchFilePaths,
          artifactPath: modeSourceDir,
        },
      )
      logger.log('')
    }
  } else {
    throw new Error(
      `No Socket patches found for Node.js ${nodeVersion}.\n\n` +
        `Expected patches in: ${PATCHES_RELEASE_DIR}`,
    )
  }

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
    '--without-sqlite',
    '--without-node-options',
  ]

  if (isProdBuild) {
    configureFlags.push('--without-inspector')
    if (IS_LINUX) {
      configureFlags.push('--enable-lto')
    }
  }

  // Cross-compilation support (Windows only).
  const hostArch = process.arch
  const isArchMismatch = arch !== hostArch
  const isCrossCompiling = isArchMismatch && IS_WINDOWS
  if (isCrossCompiling) {
    logger.log(`Cross-compiling for Windows ${arch} on ${hostArch} host`)
    configureFlags.push(`--dest-cpu=${arch}`)
  } else if (isArchMismatch) {
    logger.fail(
      `Cross-compilation not supported: building ${arch} on ${hostArch} host`,
    )
    logger.log(`   Use a native ${arch} runner instead.`)
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
      await fs.rm(outDir, { recursive: true, force: true })
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
      logger.log(`${colors.green('✓')} Windows build completed by vcbuild.bat`)
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
    logger.log(`${colors.green('✓')} Build completed in ${buildTime}`)
    logger.log('')
  }

  // Test binary.
  if (isCrossCompiling) {
    logger.step('Skipping Binary Test (Cross-Compiled)')
    logger.log(
      `Binary was cross-compiled for ${arch}, cannot test on ${hostArch} host`,
    )
    logger.log('')
  } else {
    logger.step('Testing Binary (Release)')

    logger.log('Running basic functionality tests...')
    logger.log('')

    const smokeTestEnv = {
      ...process.env,
      SOCKET_CLI_BUILD_TEST: '1',
    }

    await exec(nodeBinary, ['--version'], { env: smokeTestEnv })

    logger.log('')
    logger.log(`${colors.green('✓')} Binary is functional`)
    logger.log('')
  }

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

  // Create Release checkpoint.
  const releaseBinarySize = await getFileSize(outputReleaseBinary)
  await createCheckpoint(
    buildDir,
    packageName,
    'release',
    async () => {
      if (isCrossCompiling) {
        logger.substep(
          'Skipping smoke test (binary cross-compiled for different architecture)',
        )
        return
      }
      const versionResult = await spawn(outputReleaseBinary, ['--version'], {
        timeout: 5000,
      })
      if (versionResult.code !== 0) {
        throw new Error('Binary failed to execute --version')
      }
      logger.substep('Binary executable validated')
    },
    {
      binarySize: releaseBinarySize,
      artifactPath: outputReleaseBinary,
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
