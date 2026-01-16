/**
 * Shared tool checking utility for build packages
 */

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'

import { whichSync } from '@socketsecurity/lib/bin'
import { getDefaultLogger } from '@socketsecurity/lib/logger'

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

  console.log(`Checking required build tools for ${packageName}...\n`)

  // Check auto-installable tools
  const result = await ensureAllToolsInstalled(autoInstallableTools, {
    autoInstall,
    autoYes,
  })

  // Report auto-installable tools
  for (const tool of autoInstallableTools) {
    if (result.installed.includes(tool)) {
      console.log(`✅ ${tool} installed automatically`)
    } else if (!result.missing.includes(tool)) {
      console.log(`✓ ${tool} is available`)
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

      // If not found via file, try pkg-config
      if (!found && args) {
        const cmdPath = whichSync(cmd, { nothrow: true })
        if (cmdPath) {
          try {
            const checkResult = spawnSync(cmd, args, { encoding: 'utf8' })
            if (checkResult.status === 0) {
              logger.success(`${name} is available`)
              found = true
            }
          } catch {
            // pkg-config failed, continue
          }
        }
      }

      if (!found) {
        logger.fail(`${name} is NOT available`)
        allManualAvailable = false
      }
    } else {
      // For binary tools, check if they exist in PATH
      const binPath = whichSync(cmd, { nothrow: true })
      if (binPath) {
        console.log(`✓ ${name} is available`)
      } else {
        console.error(`✗ ${name} is NOT available`)
        allManualAvailable = false
      }
    }
  }

  // Handle missing tools
  if (!result.allAvailable || !allManualAvailable) {
    console.error('\n❌ Some required tools are missing\n')

    if (result.missing.length > 0) {
      console.error('Missing auto-installable tools:')
      for (const tool of result.missing) {
        console.error(`  - ${tool}`)
      }

      const platform = process.platform
      if (platform === 'darwin') {
        console.error('\nTo install missing tools on macOS:')
        const needsXcode = result.missing.some(t =>
          ['clang', 'clang++'].includes(t),
        )
        if (needsXcode) {
          console.error('  xcode-select --install')
        }
        for (const tool of result.missing) {
          if (!['clang', 'clang++'].includes(tool)) {
            console.error(`  brew install ${tool}`)
          }
        }
      } else if (platform === 'linux') {
        console.error('\nTo install missing tools on Linux:')
        console.error(
          `  sudo apt-get install -y ${result.missing.join(' ')} build-essential`,
        )
      }
    }

    console.error(
      '\nRe-run without --no-auto-install to attempt automatic installation',
    )
    return false
  }

  console.log('\n✅ All required tools are available\n')
  return true
}
