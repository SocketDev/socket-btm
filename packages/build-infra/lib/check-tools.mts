/**
 * Shared tool checking utility for build packages
 */

import { existsSync } from 'node:fs'
import process from 'node:process'

import { whichSync } from '@socketsecurity/lib-stable/bin'
import { getCI } from '@socketsecurity/lib-stable/env/ci'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger'
import { spawn } from '@socketsecurity/lib-stable/spawn'

import { errorMessage } from './error-utils.mts'
import { ensureAllToolsInstalled } from './tool-installer.mts'

const logger = getDefaultLogger()

/**
 * Check and optionally install required build tools
 *
 * @param {object} config - Tool configuration
 * @param {string} config.packageName - Package name for logging
 * @param {string[]} config.autoInstallableTools - Tools that can be auto-installed
 * @param {Array<{name: string, cmd: string, args?: string[], isLibrary?: boolean}>} config.manualTools - Tools that must be checked manually
 * @param {object} options - Options
 * @param {boolean} options.autoInstall - Attempt auto-installation
 * @param {boolean} options.autoYes - Auto-yes to prompts
 */
export async function checkTools(
  config,
  { autoInstall = true, autoYes = false } = {},
) {
  const { autoInstallableTools, manualTools, packageName } = config

  logger.info(`Checking required build tools for ${packageName}...`)
  logger.error('')

  // Check auto-installable tools
  const result = await ensureAllToolsInstalled(autoInstallableTools, {
    autoInstall,
    autoYes,
  })

  // Report auto-installable tools.
  for (let i = 0, { length } = autoInstallableTools; i < length; i += 1) {
    const tool = autoInstallableTools[i]
    if (result.installed.includes(tool)) {
      logger.success(`${tool} installed automatically`)
    } else if (!result.missing.includes(tool)) {
      logger.success(`${tool} is available`)
    }
  }

  // Check manual tools
  let allManualAvailable = true
  for (let i = 0, { length } = manualTools; i < length; i += 1) {
    const tool = manualTools[i]
    const { args, cmd, filePaths, isLibrary, name } = tool

    if (isLibrary) {
      let found = false

      // First, check if any of the file paths exist (for prebuilt static libs)
      if (filePaths?.length) {
        for (let i = 0, { length } = filePaths; i < length; i += 1) {
          const filePath = filePaths[i]
          if (existsSync(filePath)) {
            logger.success(`${name} is available (${filePath})`)
            found = true
            break
          }
        }
      }

      // If not found via file, try pkg-config.
      if (!found && args) {
        const cmdPath = whichSync(cmd, { nothrow: true })
        if (cmdPath) {
          try {
            // eslint-disable-next-line no-await-in-loop
            const checkResult = await spawn(cmd, args, { stdio: 'pipe' })
            if (checkResult.code === 0) {
              logger.success(`${name} is available`)
              found = true
            }
          } catch {
            // pkg-config failed, continue.
          }
        }
      }

      if (!found) {
        logger.fail(`${name} is NOT available`)
        allManualAvailable = false
      }
    } else {
      // For binary tools, check if they exist in PATH.
      const binPath = whichSync(cmd, { nothrow: true })
      if (binPath) {
        logger.success(`${name} is available`)
      } else {
        logger.fail(`${name} is NOT available`)
        allManualAvailable = false
      }
    }
  }

  // Handle missing tools.
  if (!result.allAvailable || !allManualAvailable) {
    logger.fail('Some required tools are missing')
    logger.error('')

    if (result.missing.length > 0) {
      logger.warn('Missing auto-installable tools:')
      // oxlint-disable-next-line socket/prefer-cached-for-loop -- iterable is not a bare identifier (could be Map/Set/Generator/expression)
      for (const tool of result.missing) {
        logger.info(`  - ${tool}`)
      }

      const { platform } = process
      if (platform === 'darwin') {
        logger.error('')
        logger.info('To install missing tools on macOS:')
        const needsXcode = result.missing.some(t =>
          ['clang', 'clang++'].includes(t),
        )
        if (needsXcode) {
          logger.info('  xcode-select --install')
        }
        // oxlint-disable-next-line socket/prefer-cached-for-loop -- iterable is not a bare identifier (could be Map/Set/Generator/expression)
        for (const tool of result.missing) {
          if (!['clang', 'clang++'].includes(tool)) {
            logger.info(`  brew install ${tool}`)
          }
        }
      } else if (platform === 'linux') {
        logger.error('')
        logger.info('To install missing tools on Linux:')
        logger.info(
          `  sudo apt-get install -y ${result.missing.join(' ')} build-essential`,
        )
      }
    }

    logger.error('')
    logger.info('Re-run without --no-auto-install to attempt automatic installation')
    return false
  }

  logger.success('All required tools are available')
  logger.error('')
  return true
}

/**
 * Run a package's check-tools entry-point end-to-end.
 *
 * Wraps the --no-auto-install / --yes CLI parsing + CI auto-yes detection
 * + error handling that every packages/<pkg>/scripts/check-tools.mts was
 * hand-rolling.
 *
 * Sets process.exitCode = 1 on failure.
 */
export async function runCheckTools(config) {
  try {
    const autoInstall = !process.argv.includes('--no-auto-install')
    const autoYes =
      process.argv.includes('--yes') ||
      getCI() ||
      'CONTINUOUS_INTEGRATION' in process.env

    const success = await checkTools(config, { autoInstall, autoYes })
    process.exitCode = success ? 0 : 1
  } catch (e) {
    logger.fail(`Error checking tools: ${errorMessage(e)}`)
    process.exitCode = 1
  }
}
