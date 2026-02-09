/**
 * @fileoverview Tool installation helper using external-tools.json
 *
 * Installs system dependencies with pinned versions from external-tools.json.
 * Detects platform and package manager, handles version pinning.
 */

import { execSync } from 'node:child_process'
import os from 'node:os'

import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { getToolVersion } from './pinned-versions.mjs'

const logger = getDefaultLogger()

const platform = os.platform()
const WIN32 = platform === 'win32'
const DARWIN = platform === 'darwin'

/**
 * Detect available package manager on current system
 */
function detectPackageManager() {
  if (DARWIN) {
    try {
      execSync('which brew', { stdio: 'ignore' })
      return 'brew'
    } catch {
      logger.warn('Homebrew not found. Install from: https://brew.sh')
      return undefined
    }
  }

  if (WIN32) {
    try {
      execSync('where choco', { stdio: 'ignore' })
      return 'choco'
    } catch {
      try {
        execSync('where scoop', { stdio: 'ignore' })
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
      execSync(`which ${mgr}`, { stdio: 'ignore' })
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
function isToolInstalled(toolName) {
  try {
    const cmd = WIN32 ? 'where' : 'which'
    execSync(`${cmd} ${toolName}`, { stdio: 'ignore' })
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
  if (!force && isToolInstalled(toolName)) {
    logger.success(`${toolName} already installed`)
    return true
  }

  // Detect package manager.
  const pkgMgr = detectPackageManager()
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
  let installCmd
  const versionSuffix = version ? `=${version}-*` : ''

  switch (pkgMgr) {
    case 'apt':
      installCmd = `sudo apt-get install -y ${toolName}${versionSuffix}`
      break
    case 'brew':
      // Homebrew doesn't support version pinning in the same way
      installCmd = `brew install ${toolName}`
      break
    case 'yum':
    case 'dnf':
      installCmd = `sudo ${pkgMgr} install -y ${toolName}${versionSuffix}`
      break
    case 'apk':
      installCmd = `sudo apk add ${toolName}${versionSuffix}`
      break
    case 'choco':
      installCmd = version
        ? `choco install -y ${toolName} --version=${version}`
        : `choco install -y ${toolName}`
      break
    case 'scoop':
      installCmd = `scoop install ${toolName}`
      break
    default:
      throw new Error(
        `Unsupported package manager: ${pkgMgr}. ` +
          'Supported: apt, brew, yum, dnf, apk, choco, scoop.',
      )
  }

  // Install
  logger.log(`Installing ${toolName}${version ? ` (${version})` : ''}...`)
  logger.log(`Command: ${installCmd}`)

  try {
    execSync(installCmd, { stdio: 'inherit' })
    logger.success(`${toolName} installed successfully`)
    return true
  } catch (error) {
    throw new Error(
      `Failed to install ${toolName}: ${error.message}. ` +
        `Command was: ${installCmd}`,
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
export function updatePackageCache() {
  const pkgMgr = detectPackageManager()
  if (pkgMgr === 'apt') {
    logger.log('Updating apt package cache...')
    try {
      execSync('sudo apt-get update', { stdio: 'inherit' })
      logger.success('Package cache updated')
    } catch (error) {
      logger.warn(`Failed to update package cache: ${error.message}`)
    }
  }
}
