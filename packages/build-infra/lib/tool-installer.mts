/**
 * Tool Installation Utilities.
 *
 * Provides utilities for automatically installing missing build tools
 * using platform-specific package managers (brew, apt, choco, etc.)
 * and direct downloads for version-pinned tools.
 *
 * Tool categories: - "pinned": Exact version required, auto-downloaded with
 * checksum verification - All others: Any recent version, installed via package
 * manager (default)
 */

import process from 'node:process'

import binPkg from '@socketsecurity/lib-stable/bin/which'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { getPlatform } from './build-env.mts'
import { errorMessage } from './error-utils.mts'
import { downloadAndCache, getCachedToolBinary } from './tool-downloader.mts'
import { getToolConfig } from './pinned-versions.mts'
import {
  detectPackageManagers,
  getInstallInstructions,
  getPackageManagerInstructions,
  getPreferredPackageManager,
} from './tool-installer-config.mts'
import {
  checkElevatedPrivileges,
  installPackageManager,
  installTool,
  resolvePinnedArtifact,
  verifyToolWorks,
} from './tool-installer-impl.mts'

export {
  checkElevatedPrivileges,
  detectPackageManagers,
  getInstallInstructions,
  getPackageManagerInstructions,
  getPreferredPackageManager,
  installPackageManager,
  installTool,
  resolvePinnedArtifact,
  verifyToolWorks,
}

const { whichSync } = binPkg
const logger = getDefaultLogger()

/**
 * Ensure all required tools are installed.
 *
 * @param {string[]} tools - Array of tool names to check.
 * @param {object} options - Options.
 * @param {boolean} options.autoInstall - Attempt auto-installation (default:
 *   true).
 * @param {boolean} options.autoYes - Auto-yes to prompts (default: false).
 *
 * @returns {Promise<{
 *   allAvailable: boolean
 *   missing: string[]
 *   installed: string[]
 * }>}
 */
export async function ensureAllToolsInstalled(
  tools,
  { autoInstall = true, autoYes = false } = {},
) {
  const missing = []
  const installed = []

  for (let i = 0; i < tools.length; i++) {
    const tool = tools[i]
    logger.substep(`[${i + 1}/${tools.length}] Checking ${tool}`)

    // eslint-disable-next-line no-await-in-loop -- Tools must be installed sequentially
    const result = await ensureToolInstalled(tool, { autoInstall, autoYes })

    if (!result.available) {
      missing.push(tool)
    } else if (result.installed) {
      installed.push(tool)
    }
  }

  // Summary
  if (tools.length > 1) {
    if (missing.length === 0) {
      logger.success(
        `All tools available (${tools.length}/${tools.length}${installed.length > 0 ? `, ${installed.length} newly installed` : ''})`,
      )
    } else {
      logger.warn(
        `${tools.length - missing.length}/${tools.length} tools available (${missing.length} missing: ${missing.join(', ')})`,
      )
    }
  }

  return {
    allAvailable: missing.length === 0,
    installed,
    missing,
  }
}

/**
 * Ensure a package manager is available, installing if needed.
 *
 * @param {object} options - Options.
 * @param {boolean} options.autoInstall - Attempt auto-installation (default:
 *   false).
 * @param {boolean} options.autoYes - Auto-yes to prompts (default: false).
 *
 * @returns {Promise<{
 *   available: boolean
 *   manager: string | undefined
 *   installed: boolean
 * }>}
 */
export async function ensurePackageManagerAvailable({
  autoInstall = false,
  autoYes = false,
} = {}) {
  // Check if any package manager is already available.
  const managers = detectPackageManagers()
  if (managers.length > 0) {
    return {
      available: true,
      installed: false,
      manager: managers[0],
    }
  }

  if (!autoInstall) {
    return {
      available: false,
      installed: false,
      manager: undefined,
    }
  }

  // Attempt to install preferred package manager.
  const preferred = getPreferredPackageManager()
  if (!preferred) {
    return {
      available: false,
      installed: false,
      manager: undefined,
    }
  }

  logger.substep(
    `No package manager detected, attempting to install ${preferred}`,
  )
  const installed = await installPackageManager(preferred, { autoYes })

  return {
    available: installed,
    installed,
    manager: installed ? preferred : undefined,
  }
}

/**
 * Ensure a pinned tool is at the exact required version.
 * Checks system PATH first, then user-level cache, then downloads.
 *
 * @param {string} tool - Tool name.
 * @param {object} config - Tool config from external-tools.json.
 * @param {boolean} autoInstall - Whether to auto-download if missing.
 *
 * @returns {Promise<{
 *   available: boolean
 *   installed: boolean
 *   path: string | undefined
 *   error: string | undefined
 * }>}
 */
export async function ensurePinnedTool(tool, config, autoInstall) {
  const requiredVersion = config.version
  if (!requiredVersion) {
    return {
      available: false,
      installed: false,
      error: `Pinned tool ${tool} missing version`,
    }
  }

  // Check system binary version
  const binPath = whichSync(tool, { nothrow: true })
  if (binPath) {
    try {
      const versionArgs = ['version']
      const result = await spawn(binPath, versionArgs, { stdio: 'pipe' })
      const version = (result.stdout?.toString() || '').trim()
      if (version === requiredVersion) {
        logger.substep(`${tool} ${version} found at ${binPath}`)
        return { available: true, installed: false, path: binPath }
      }
      if (version) {
        logger.warn(`System ${tool} is ${version}, need ${requiredVersion}`)
      }
    } catch {
      // Can't determine version — fall through to download
    }
  }

  if (!autoInstall) {
    return {
      available: false,
      installed: false,
      error: `${tool} ${requiredVersion} not found`,
    }
  }

  // Resolve artifact from checksum file
  const artifact = resolvePinnedArtifact(tool, requiredVersion)
  if (!artifact) {
    return {
      available: false,
      installed: false,
      error: `No checksum data for ${tool} ${requiredVersion} on this platform`,
    }
  }

  // Check cache, then download
  try {
    const cachedBin = getCachedToolBinary(
      tool,
      requiredVersion,
      process.platform,
      process.arch,
      artifact.binary,
      artifact.sha256,
    )
    if (cachedBin) {
      logger.substep(`Using cached ${tool} ${requiredVersion}`)
      return { available: true, installed: false, path: cachedBin }
    }

    logger.substep(`${tool} ${requiredVersion} not found, downloading…`)
    const downloadedPath = await downloadAndCache(
      tool,
      artifact,
      requiredVersion,
      process.platform,
      process.arch,
    )
    return { available: true, installed: true, path: downloadedPath }
  } catch (e) {
    const msg = errorMessage(e)
    logger.error(`Failed to get ${tool} ${requiredVersion}: ${msg}`)
    return { available: false, installed: false, error: msg }
  }
}

/**
 * Ensure a tool is installed, attempting auto-installation if needed. Pinned
 * tools (category: "pinned") are auto-downloaded with checksum verification.
 * All other tools use package manager installation (existing behavior).
 *
 * @param {string} tool - Tool name to check/install.
 * @param {object} options - Options.
 * @param {boolean} options.autoInstall - Attempt auto-installation if missing
 *   (default: true).
 * @param {boolean} options.autoYes - Automatically answer yes to prompts
 *   (default: false).
 * @param {object} options.toolOptions - Hierarchical loading options for
 *   external-tools.json.
 *
 * @returns {Promise<{
 *   available: boolean
 *   installed: boolean
 *   path: string | undefined
 *   packageManager: string | undefined
 *   error: string | undefined
 * }>}
 */
export async function ensureToolInstalled(
  tool,
  { autoInstall = true, autoYes = false, toolOptions } = {},
) {
  const config = getToolConfig(tool, toolOptions)

  // Pinned tools: exact version match via direct download.
  // Detected by existence of tool-checksums/<tool>-<version>.json.
  if (config?.version && resolvePinnedArtifact(tool, config.version)) {
    return ensurePinnedTool(tool, config, autoInstall)
  }

  // All other tools: existing package manager behavior
  // Check if binary exists in PATH.
  const binPath = whichSync(tool, { nothrow: true })
  if (binPath) {
    // Binary exists, but verify it actually works (catches broken dependencies).
    const verifyArgs = config?.verify || ['--version']
    const works = await verifyToolWorks(tool, verifyArgs)
    if (works) {
      return { available: true, installed: false, packageManager: undefined }
    }

    // Tool exists but doesn't work - likely missing dependency.
    // Try to install dependencies first.
    if (config?.dependencies?.length) {
      logger.warn(`${tool} exists but failed to run - checking dependencies…`)
      // oxlint-disable-next-line socket/prefer-cached-for-loop -- iterable is not a bare identifier (could be Map/Set/Generator/expression)
      for (const dep of config.dependencies) {
        // eslint-disable-next-line no-await-in-loop
        const depResult = await ensureToolInstalled(dep, {
          autoInstall,
          autoYes,
          toolOptions,
        })
        if (!depResult.available) {
          const depConfig = getToolConfig(dep, toolOptions)
          return {
            available: false,
            error: `Dependency ${dep} not available: ${depConfig?.note || 'install required'}`,
            installed: false,
            packageManager: undefined,
          }
        }
      }
      // Dependencies installed, try verifying again.
      const worksAfterDeps = await verifyToolWorks(tool, verifyArgs)
      if (worksAfterDeps) {
        return { available: true, installed: false, packageManager: undefined }
      }
    }

    // Still broken - suggest reinstall.
    const platform = getPlatform()

    logger.error(`${tool} exists but failed to run`)
    if (config?.notes) {
      logger.substep(config.notes)
    }
    if (platform === 'darwin') {
      logger.substep(`Try: brew reinstall ${tool}`)
    } else if (platform === 'linux') {
      logger.substep(`Try: sudo apt-get install --reinstall ${tool}`)
    }

    return {
      available: false,
      error: `${tool} exists but failed to run (possible broken dependency)`,
      installed: false,
      packageManager: undefined,
    }
  }

  if (!autoInstall) {
    return { available: false, installed: false, packageManager: undefined }
  }

  // Install dependencies first.
  if (config?.dependencies?.length) {
    logger.substep(`Installing dependencies for ${tool}...`)
    // oxlint-disable-next-line socket/prefer-cached-for-loop -- iterable is not a bare identifier (could be Map/Set/Generator/expression)
    for (const dep of config.dependencies) {
      // eslint-disable-next-line no-await-in-loop
      const depResult = await ensureToolInstalled(dep, {
        autoInstall,
        autoYes,
        toolOptions,
      })
      if (!depResult.available) {
        return {
          available: false,
          error: `Failed to install dependency: ${dep}`,
          installed: false,
          packageManager: undefined,
        }
      }
    }
  }

  // Detect available package managers.
  const managers = detectPackageManagers()
  if (!managers.length) {
    logger.warn(`No package manager detected for auto-installing ${tool}`)
    return { available: false, installed: false, packageManager: undefined }
  }

  // Try to install using the first available package manager.
  const packageManager = managers[0]
  if (!packageManager) {
    // Defensive fallback for race conditions
    logger.error('Package manager became unavailable')
    return { available: false, installed: false, packageManager: undefined }
  }
  logger.substep(`Attempting to install ${tool} using ${packageManager}`)

  const installed = await installTool(tool, packageManager, { autoYes })

  // Verify installation works.
  if (installed) {
    const verifyArgs = config?.verify || ['--version']
    const works = await verifyToolWorks(tool, verifyArgs)
    if (!works) {
      logger.error(`${tool} installed but failed verification`)
      return {
        available: false,
        error: `${tool} installed but failed to run`,
        installed: true,
        packageManager,
      }
    }
  }

  return {
    available: installed,
    installed,
    packageManager: installed ? packageManager : undefined,
  }
}
