/**
 * @fileoverview Consolidated build toolchain setup utilities
 *
 * Provides platform-specific build tool installation for C/C++ packages.
 * Replaces duplicate setup-build-toolchain directories across packages.
 *
 * Usage:
 *   import { createSetupToolchain } from 'build-infra/lib/setup-build-toolchain.mjs'
 *
 *   const setup = createSetupToolchain({
 *     darwin: ['clang', 'cmake', 'make'],
 *     linux: ['gcc', 'make', 'cmake', 'liblzma-dev'],
 *     win32: ['mingw-w64', 'cmake', 'make'],
 *   })
 *
 *   await setup()
 */

import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { installTools, updatePackageCache } from './install-tools.mjs'

/**
 * @typedef {Object} ToolchainConfig
 * @property {string[]} [darwin] - Tools to install on macOS
 * @property {string[]} [linux] - Tools to install on Linux
 * @property {string[]} [win32] - Tools to install on Windows
 * @property {string} [packageRoot] - Package root directory (auto-detected if not provided)
 * @property {string} [darwinNote] - Note to display after macOS setup
 * @property {string} [linuxNote] - Note to display after Linux setup
 * @property {string} [win32Note] - Note to display after Windows setup
 */

/**
 * Create a setup function for the current platform
 * @param {ToolchainConfig} config
 * @returns {() => Promise<boolean>}
 */
export function createSetupToolchain(config) {
  const platform = process.platform

  return async function setup(packageRoot) {
    const logger = getDefaultLogger()

    if (platform === 'darwin') {
      return setupDarwin(config, packageRoot, logger)
    }
    if (platform === 'linux') {
      return setupLinux(config, packageRoot, logger)
    }
    if (platform === 'win32') {
      return setupWindows(config, packageRoot, logger)
    }
    logger.warn(`Unsupported platform: ${platform}`)
    return false
  }
}

/**
 * macOS setup
 */
async function setupDarwin(config, packageRoot, logger) {
  const tools = config.darwin || ['clang', 'make']

  logger.log('Installing macOS build dependencies...')

  const { failed, installed } = await installTools(tools, {
    packageRoot,
    skipVersionPin: true,
  })

  if (failed.length > 0) {
    logger.warn(`Failed to install: ${failed.join(', ')}`)
    logger.info('Install manually:')
    logger.info('  xcode-select --install  # For clang/clang++')
    if (tools.some(t => !['clang', 'clang++'].includes(t))) {
      const brewTools = tools.filter(t => !['clang', 'clang++'].includes(t))
      logger.info(`  brew install ${brewTools.join(' ')}`)
    }
    return false
  }

  logger.success(`Installed: ${installed.join(', ')}`)
  if (config.darwinNote) {
    logger.info(config.darwinNote)
  }
  return true
}

/**
 * Linux setup
 */
async function setupLinux(config, packageRoot, logger) {
  const tools = config.linux || ['gcc', 'make']

  logger.log('Installing Linux build dependencies...')
  updatePackageCache()

  const { failed, installed } = await installTools(tools, {
    packageRoot,
  })

  if (failed.length > 0) {
    logger.error(`Failed to install: ${failed.join(', ')}`)
    logger.info(
      'You may need to install these manually. See packages/build-infra/docs/prerequisites.md',
    )
    return false
  }

  logger.success(`Installed: ${installed.join(', ')}`)
  if (config.linuxNote) {
    logger.info(config.linuxNote)
  }
  return true
}

/**
 * Windows setup
 */
async function setupWindows(config, packageRoot, logger) {
  const tools = config.win32 || ['mingw-w64', 'make']

  logger.log('Installing Windows build dependencies...')

  const { failed, installed } = await installTools(tools, {
    packageRoot,
  })

  if (failed.length > 0) {
    logger.error(`Failed to install: ${failed.join(', ')}`)
    logger.info('Install manually:')
    logger.info(`  choco install ${tools.join(' ')}`)
    logger.info('  -or-')
    logger.info(`  scoop install ${tools.join(' ')}`)
    return false
  }

  logger.success(`Installed: ${installed.join(', ')}`)
  if (config.win32Note) {
    logger.info(config.win32Note)
  }
  return true
}

/**
 * Check if running in CI environment
 */
export function isCI() {
  return Boolean(process.env.CI)
}
