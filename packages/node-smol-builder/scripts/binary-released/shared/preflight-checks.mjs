/**
 * Pre-flight checks for Node.js build.
 * Validates required tools, build environment, and compression tools.
 */

import { existsSync } from 'node:fs'
import path from 'node:path'

import {
  checkCompiler,
  checkDiskSpace,
  checkNetworkConnectivity,
  checkPythonVersion,
  exec,
} from 'build-infra/lib/build-helpers'
import { printError } from 'build-infra/lib/build-output'
import { getMinPythonVersion } from 'build-infra/lib/version-helpers'
import {
  ensureGccVersion,
  getGccInstructions,
} from 'build-infra/lib/compiler-installer'
import { getBinOutDir } from 'build-infra/lib/constants'
import {
  ensureAllToolsInstalled,
  ensurePackageManagerAvailable,
  getInstallInstructions,
  getPackageManagerInstructions,
} from 'build-infra/lib/tool-installer'

import { whichSync } from '@socketsecurity/lib/bin'
import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { BINFLATE_DIR, BINPRESS_DIR } from './paths.mjs'

const logger = getDefaultLogger()
const IS_MACOS = process.platform === 'darwin'
const WIN32 = process.platform === 'win32'

/**
 * Check for required build tools.
 *
 * @param {object} options - Check options
 * @param {boolean} options.autoYes - Auto-confirm installations
 * @param {string} options.arch - Target architecture
 */
export async function checkRequiredTools({ arch, autoYes }) {
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
  const manualTools = [{ checkExists: true, cmd: 'strip', name: 'strip' }]

  if (IS_MACOS && arch === 'arm64') {
    manualTools.push({
      checkExists: true,
      cmd: 'codesign',
      name: 'codesign',
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
 *
 * @param {string} buildDir - Build directory path
 */
export async function checkBuildEnvironment(buildDir) {
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
  const requiredPythonVersion = getMinPythonVersion()
  const python = await checkPythonVersion(requiredPythonVersion)
  if (python.available && python.sufficient) {
    logger.success(`Python ${python.version} is available`)
  } else if (python.available && !python.sufficient) {
    logger.fail(
      `Python ${python.version} is too old (need Python ${requiredPythonVersion}+)`,
    )
    allChecks = false
  } else {
    logger.fail('Python is not available')
    logger.substep(
      `Node.js build requires Python ${requiredPythonVersion} or later`,
    )
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
        `Python: Install Python ${requiredPythonVersion}+ (python.org or brew install python)`,
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
export async function ensureCompressionTools() {
  logger.step('Checking Compression Tools')

  const currentPlatform = process.platform

  let compressorBinary
  let decompressorBinary
  let makefile

  // Select platform-specific Makefile.
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
    makefile = 'Makefile.macos'
  } else {
    logger.warn(
      `Unknown platform: ${currentPlatform}, skipping compression tools`,
    )
    return
  }

  const decompressorPath = path.join(
    getBinOutDir(BINFLATE_DIR),
    decompressorBinary,
  )
  const compressorPath = path.join(getBinOutDir(BINPRESS_DIR), compressorBinary)

  // Check if tools already exist.
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

  // Install dependencies if needed (Linux only).
  if (currentPlatform === 'linux') {
    logger.log('Checking for liblzma development headers...')

    try {
      await exec('pkg-config', ['--exists', 'liblzma'], {
        encoding: 'utf8',
        shell: WIN32,
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

  // Build compression tools - each package has its own Makefile.
  logger.log('')
  try {
    // Build binpress (compressor) - use build script to ensure LIEF is built first.
    if (!compressorExists) {
      logger.log('Building binpress (compressor)...')
      await exec('node', ['scripts/build.mjs', '--force'], {
        cwd: BINPRESS_DIR,
        shell: WIN32,
        stdio: 'inherit',
      })
    }

    // Build binflate (decompressor) - use build script for consistency.
    if (!decompressorExists) {
      logger.log('Building binflate (decompressor)...')
      await exec('node', ['scripts/build.mjs', '--force'], {
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
