/**
 * Shared tool checking utility for build packages
 */

import { existsSync } from 'node:fs'

import { whichSync } from '@socketsecurity/lib/bin'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

import { ensureAllToolsInstalled } from './tool-installer.mjs'

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

  logger.info(`Checking required build tools for ${packageName}...\n`)

  // Check auto-installable tools
  const result = await ensureAllToolsInstalled(autoInstallableTools, {
    autoInstall,
    autoYes,
  })

  // Report auto-installable tools.
  for (const tool of autoInstallableTools) {
    if (result.installed.includes(tool)) {
      logger.success(`${tool} installed automatically`)
    } else if (!result.missing.includes(tool)) {
      logger.success(`${tool} is available`)
    }
  }

  // Check manual tools
  let allManualAvailable = true
  for (const tool of manualTools) {
    const { args, cmd, filePaths, isLibrary, name } = tool

    if (isLibrary) {
      let found = false

      // First, check if any of the file paths exist (for prebuilt static libs)
      if (filePaths?.length) {
        for (const filePath of filePaths) {
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
    logger.fail('Some required tools are missing\n')

    if (result.missing.length > 0) {
      logger.warn('Missing auto-installable tools:')
      for (const tool of result.missing) {
        logger.info(`  - ${tool}`)
      }

      const platform = process.platform
      if (platform === 'darwin') {
        logger.info('\nTo install missing tools on macOS:')
        const needsXcode = result.missing.some(t =>
          ['clang', 'clang++'].includes(t),
        )
        if (needsXcode) {
          logger.info('  xcode-select --install')
        }
        for (const tool of result.missing) {
          if (!['clang', 'clang++'].includes(tool)) {
            logger.info(`  brew install ${tool}`)
          }
        }
      } else if (platform === 'linux') {
        logger.info('\nTo install missing tools on Linux:')
        logger.info(
          `  sudo apt-get install -y ${result.missing.join(' ')} build-essential`,
        )
      }
    }

    logger.info(
      '\nRe-run without --no-auto-install to attempt automatic installation',
    )
    return false
  }

  logger.success('All required tools are available\n')
  return true
}
