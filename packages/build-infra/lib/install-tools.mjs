/**
 * @fileoverview Tool installation helper using external-tools.json
 *
 * Installs system dependencies with pinned versions from external-tools.json.
 * Detects platform and package manager, handles version pinning.
 */

import os from 'node:os'

import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

import { getToolVersion } from './pinned-versions.mjs'

const logger = getDefaultLogger()

const platform = os.platform()
const WIN32 = platform === 'win32'
const DARWIN = platform === 'darwin'

/**
 * Detect available package manager on current system
 */
async function detectPackageManager() {
  if (DARWIN) {
    try {
      await spawn('which', ['brew'], { stdio: 'ignore' })
      return 'brew'
    } catch {
      logger.warn('Homebrew not found. Install from: https://brew.sh')
      return undefined
    }
  }

  if (WIN32) {
    try {
      await spawn('where', ['choco'], { stdio: 'ignore' })
      return 'choco'
    } catch {
      try {
        await spawn('where', ['scoop'], { stdio: 'ignore' })
        return 'scoop'
      } catch {
        logger.warn(
          'No package manager found. Install Chocolatey or Scoop first.',
        )
        return undefined
      }
    }
  }

  // Linux - check for apt, yum, dnf, apk
  const managers = ['apt', 'yum', 'dnf', 'apk']
  for (const mgr of managers) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await spawn('which', [mgr], { stdio: 'ignore' })
      return mgr
    } catch {
      // Try next
    }
  }

  logger.warn('No supported package manager found on Linux')
  return undefined
}

/**
 * Check if a tool is already installed
 */
async function isToolInstalled(toolName) {
  try {
    const cmd = WIN32 ? 'where' : 'which'
    await spawn(cmd, [toolName], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/**
 * Install a single tool with version pinning
 *
 * @param {string} toolName - Tool name from external-tools.json
 * @param {object} options - Installation options
 * @param {string} [options.packageRoot] - Package root for hierarchical loading
 * @param {string} [options.checkpointName] - Checkpoint name
 * @param {boolean} [options.force] - Force reinstall even if already installed
 * @param {boolean} [options.skipVersionPin] - Skip version pinning (install latest)
 * @returns {Promise<boolean>} - True if installed successfully
 */
export async function installTool(toolName, options = {}) {
  const {
    checkpointName,
    force = false,
    packageRoot,
    skipVersionPin = false,
  } = options

  logger.log(`Checking ${toolName}...`)

  // Check if already installed
  if (!force && (await isToolInstalled(toolName))) {
    logger.success(`${toolName} already installed`)
    return true
  }

  // Detect package manager.
  const pkgMgr = await detectPackageManager()
  if (!pkgMgr) {
    throw new Error(
      `Cannot install ${toolName}: no supported package manager found. ` +
        'Install apt (Debian/Ubuntu), brew (macOS), yum/dnf (RHEL/Fedora), or apk (Alpine).',
    )
  }

  // Get pinned version
  let version
  if (!skipVersionPin) {
    try {
      version = getToolVersion(toolName, pkgMgr, {
        checkpointName,
        packageRoot,
      })
    } catch {
      logger.warn(
        `No pinned version found for ${toolName} with ${pkgMgr}, installing latest`,
      )
    }
  }

  // Build install command
  let command
  let args
  const versionSuffix = version ? `=${version}-*` : ''

  switch (pkgMgr) {
    case 'apt':
      command = 'sudo'
      args = ['apt-get', 'install', '-y', `${toolName}${versionSuffix}`]
      break
    case 'brew':
      // Homebrew doesn't support version pinning in the same way
      command = 'brew'
      args = ['install', toolName]
      break
    case 'yum':
    case 'dnf':
      command = 'sudo'
      args = [pkgMgr, 'install', '-y', `${toolName}${versionSuffix}`]
      break
    case 'apk':
      command = 'sudo'
      args = ['apk', 'add', `${toolName}${versionSuffix}`]
      break
    case 'choco':
      command = 'choco'
      args = ['install', '-y', toolName]
      if (version) {
        args.push(`--version=${version}`)
      }
      break
    case 'scoop':
      command = 'scoop'
      args = ['install', toolName]
      break
    default:
      throw new Error(
        `Unsupported package manager: ${pkgMgr}. ` +
          'Supported: apt, brew, yum, dnf, apk, choco, scoop.',
      )
  }

  // Install
  logger.log(`Installing ${toolName}${version ? ` (${version})` : ''}...`)
  logger.log(`Command: ${command} ${args.join(' ')}`)

  try {
    await spawn(command, args, { stdio: 'inherit' })
    logger.success(`${toolName} installed successfully`)
    return true
  } catch (error) {
    throw new Error(
      `Failed to install ${toolName}: ${error.message}. ` +
        `Command was: ${command} ${args.join(' ')}`,
    )
  }
}

/**
 * Install multiple tools
 *
 * @param {string[]} toolNames - Array of tool names
 * @param {object} options - Installation options (same as installTool)
 * @returns {Promise<{installed: string[], failed: string[]}>}
 */
export async function installTools(toolNames, options = {}) {
  const installed = []
  const failed = []

  // Sequential installation is intentional - apt-get requires serialization
  for (let i = 0; i < toolNames.length; i++) {
    const toolName = toolNames[i]
    logger.substep(`[${i + 1}/${toolNames.length}] Checking ${toolName}`)

    // eslint-disable-next-line no-await-in-loop
    const success = await installTool(toolName, options)
    if (success) {
      installed.push(toolName)
    } else {
      failed.push(toolName)
    }
  }

  // Summary
  if (toolNames.length > 1) {
    if (failed.length === 0) {
      logger.success(
        `All tools installed successfully (${installed.length}/${toolNames.length})`,
      )
    } else {
      logger.warn(
        `Installed ${installed.length}/${toolNames.length} tools (${failed.length} failed: ${failed.join(', ')})`,
      )
    }
  }

  return { failed, installed }
}

/**
 * Ensure apt cache is updated (Linux only, run once before installing multiple packages)
 */
export async function updatePackageCache() {
  const pkgMgr = await detectPackageManager()
  if (pkgMgr === 'apt') {
    logger.log('Updating apt package cache...')
    try {
      await spawn('sudo', ['apt-get', 'update'], { stdio: 'inherit' })
      logger.success('Package cache updated')
    } catch (error) {
      logger.warn(`Failed to update package cache: ${error.message}`)
    }
  }
}
