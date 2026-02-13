/**
 * Compiler Installation and Version Management Utilities
 *
 * Provides utilities for ensuring the correct compiler versions are installed
 * and configured for building native dependencies.
 */

import { which } from '@socketsecurity/lib/bin'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

import { getPlatform } from './build-env.mjs'
import { printError } from './build-output.mjs'
import { detectPackageManagers } from './tool-installer.mjs'

const logger = getDefaultLogger()

/**
 * Compiler version requirements.
 */
export const COMPILER_REQUIREMENTS = {
  gcc: {
    minVersion: '12.2.0',
    reason: 'Node.js v24+ requires GCC 12.2+ for C++20 constexpr support',
  },
  gxx: {
    minVersion: '12.2.0',
    reason: 'Node.js v24+ requires G++ 12.2+ for C++20 constexpr support',
  },
}

/**
 * Parse semantic version string.
 *
 * @param {string} versionString - Version string (e.g., "12.2.0", "11.4.0-1ubuntu1~22.04")
 * @returns {{major: number, minor: number, patch: number}|undefined}
 */
function parseVersion(versionString) {
  const match = versionString.match(/(\d+)\.(\d+)\.(\d+)/)
  if (!match) {
    return undefined
  }

  return {
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
    patch: Number.parseInt(match[3], 10),
  }
}

/**
 * Compare two semantic versions.
 *
 * @param {string} version1 - First version
 * @param {string} version2 - Second version
 * @returns {number} -1 if version1 < version2, 0 if equal, 1 if version1 > version2
 */
function compareVersions(version1, version2) {
  const v1 = parseVersion(version1)
  const v2 = parseVersion(version2)

  if (!v1 || !v2) {
    return 0
  }

  if (v1.major !== v2.major) {
    return v1.major < v2.major ? -1 : 1
  }
  if (v1.minor !== v2.minor) {
    return v1.minor < v2.minor ? -1 : 1
  }
  if (v1.patch !== v2.patch) {
    return v1.patch < v2.patch ? -1 : 1
  }

  return 0
}

/**
 * Get GCC version.
 *
 * @param {string} gccPath - Path to GCC binary (default: 'gcc')
 * @returns {Promise<string|undefined>} Version string or undefined if not found
 */
async function getGccVersion(gccPath = 'gcc') {
  try {
    const result = await spawn(gccPath, ['--version'], {})

    if (result.code !== 0) {
      return undefined
    }

    const stdout = result.stdout?.toString() || ''
    const match = stdout.match(/gcc.*?(\d+\.\d+\.\d+)/)
    return match ? match[1] : undefined
  } catch {
    return undefined
  }
}

/**
 * Check if GCC version meets minimum requirements.
 *
 * @param {string} gccPath - Path to GCC binary
 * @param {string} minVersion - Minimum required version
 * @returns {Promise<{installed: boolean, version: string|undefined, meetsRequirements: boolean}>}
 */
async function checkGccVersion(gccPath, minVersion) {
  const version = await getGccVersion(gccPath)

  if (!version) {
    return {
      installed: false,
      version: undefined,
      meetsRequirements: false,
    }
  }

  const meetsRequirements = compareVersions(version, minVersion) >= 0

  return {
    installed: true,
    version,
    meetsRequirements,
  }
}

/**
 * Install GCC on Linux using apt.
 *
 * @param {string} version - GCC major version (e.g., '12')
 * @returns {Promise<boolean>} True if installation succeeded
 */
async function installGccApt(version) {
  const gccPackage = `gcc-${version}`
  const gxxPackage = `g++-${version}`

  logger.info(`Installing ${gccPackage} and ${gxxPackage}...`)

  try {
    const sudoPath = await which('sudo', { nothrow: true })
    if (!sudoPath || Array.isArray(sudoPath)) {
      printError('sudo not found in PATH')
      return false
    }

    // Install GCC and G++
    const installResult = await spawn(
      sudoPath,
      ['apt-get', 'install', '-y', gccPackage, gxxPackage],
      {
        stdio: 'inherit',
      },
    )

    if (installResult.code !== 0) {
      printError(`Failed to install GCC ${version}`)
      return false
    }

    // Set as default using update-alternatives
    logger.info(`Setting GCC ${version} as default...`)

    const gccPath = `/usr/bin/gcc-${version}`
    const gxxPath = `/usr/bin/g++-${version}`

    const gccAltResult = await spawn(
      sudoPath,
      [
        'update-alternatives',
        '--install',
        '/usr/bin/gcc',
        'gcc',
        gccPath,
        '100',
      ],
      { stdio: 'pipe' },
    )

    const gxxAltResult = await spawn(
      sudoPath,
      [
        'update-alternatives',
        '--install',
        '/usr/bin/g++',
        'g++',
        gxxPath,
        '100',
      ],
      { stdio: 'pipe' },
    )

    if (gccAltResult.code !== 0 || gxxAltResult.code !== 0) {
      logger.warn('Failed to set GCC as default, but installation succeeded')
    }

    return true
  } catch (e) {
    printError(`Error installing GCC ${version}: ${e.message}`)
    return false
  }
}

/**
 * Ensure GCC meets minimum version requirements.
 *
 * @param {object} options - Options
 * @param {boolean} options.autoInstall - Attempt auto-installation if version too old (default: true)
 * @param {boolean} options.quiet - Suppress output (default: false)
 * @returns {Promise<{available: boolean, version: string|undefined, installed: boolean}>}
 */
export async function ensureGccVersion({
  autoInstall = true,
  quiet = false,
} = {}) {
  const requirement = COMPILER_REQUIREMENTS.gcc
  const minVersion = requirement.minVersion

  if (!quiet) {
    logger.substep('Checking GCC version...')
  }

  // Check current GCC version
  const currentCheck = await checkGccVersion('gcc', minVersion)

  if (currentCheck.meetsRequirements) {
    if (!quiet) {
      logger.success(
        `GCC ${currentCheck.version} meets requirements (>= ${minVersion})`,
      )
    }
    return {
      available: true,
      version: currentCheck.version,
      installed: false,
    }
  }

  if (currentCheck.installed && !quiet) {
    logger.warn(
      `GCC ${currentCheck.version} is installed but does not meet minimum version ${minVersion}`,
    )
    logger.info(requirement.reason)
  }

  if (!autoInstall) {
    return {
      available: false,
      version: currentCheck.version,
      installed: false,
    }
  }

  // Attempt to install GCC 12
  const platform = getPlatform()
  if (platform !== 'linux') {
    if (!quiet) {
      logger.warn('Automatic GCC installation is only supported on Linux')
    }
    return {
      available: false,
      version: currentCheck.version,
      installed: false,
    }
  }

  // Check if apt is available
  const managers = detectPackageManagers()
  if (!managers.includes('apt')) {
    if (!quiet) {
      logger.warn('Automatic GCC installation requires apt package manager')
    }
    return {
      available: false,
      version: currentCheck.version,
      installed: false,
    }
  }

  // Install GCC 12
  logger.substep('Installing GCC 12...')
  const targetMajorVersion = '12'
  const installed = await installGccApt(targetMajorVersion)

  if (!installed) {
    return {
      available: false,
      version: currentCheck.version,
      installed: false,
    }
  }

  // Verify installation
  const verifyCheck = await checkGccVersion('gcc', minVersion)
  if (verifyCheck.meetsRequirements) {
    if (!quiet) {
      logger.success(`GCC ${verifyCheck.version} installed successfully`)
    }
    return {
      available: true,
      version: verifyCheck.version,
      installed: true,
    }
  }

  if (!quiet) {
    printError('GCC installation completed but version check failed')
  }
  return {
    available: false,
    version: verifyCheck.version,
    installed: false,
  }
}

/**
 * Get GCC installation instructions.
 *
 * @returns {string[]} Array of installation instruction strings
 */
export function getGccInstructions() {
  const requirement = COMPILER_REQUIREMENTS.gcc
  const platform = getPlatform()

  const instructions = []
  instructions.push(`GCC ${requirement.minVersion}+ is required`)
  instructions.push(`Reason: ${requirement.reason}`)
  instructions.push('')

  if (platform === 'linux') {
    instructions.push('Install GCC 12 on Ubuntu/Debian:')
    instructions.push('  sudo apt-get update')
    instructions.push('  sudo apt-get install -y gcc-12 g++-12')
    instructions.push(
      '  sudo update-alternatives --install /usr/bin/gcc gcc /usr/bin/gcc-12 100',
    )
    instructions.push(
      '  sudo update-alternatives --install /usr/bin/g++ g++ /usr/bin/g++-12 100',
    )
  } else if (platform === 'darwin') {
    instructions.push('On macOS, use the Xcode Command Line Tools:')
    instructions.push('  xcode-select --install')
    instructions.push('')
    instructions.push('Or install via Homebrew:')
    instructions.push('  brew install gcc@12')
  } else {
    instructions.push('Please install GCC 12+ for your platform')
  }

  return instructions
}
