/**
 * Tool Installation Utilities
 *
 * Provides utilities for automatically installing missing build tools
 * using platform-specific package managers (brew, apt, choco, etc.).
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import binPkg, { which } from '@socketsecurity/lib/bin'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

import { getPlatform } from './build-env.mjs'
import { printError } from './build-output.mjs'
import { getToolVersion, getToolConfig } from './pinned-versions.mjs'

const { whichSync } = binPkg
const logger = getDefaultLogger()
const __dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * Tool installation configurations.
 * Sourced from external-tools.json files via pinned-versions.mjs.
 * Use getToolConfig(toolName, options) for hierarchical tool lookup.
 */

/**
 * Package manager configuration per platform.
 */
const PACKAGE_MANAGER_CONFIGS = {
  __proto__: null,
  darwin: {
    preferred: 'brew',
    available: ['brew'],
    brew: {
      name: 'Homebrew',
      binary: 'brew',
      installScript:
        '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"',
      checkCommand: 'brew --version',
      description: 'macOS package manager',
    },
  },
  linux: {
    preferred: 'apt',
    available: ['apt', 'apk', 'dnf', 'yum'],
    apt: {
      name: 'APT',
      binary: 'apt-get',
      // Pre-installed on Debian/Ubuntu.
      installScript: undefined,
      checkCommand: 'apt-get --version',
      description: 'Debian/Ubuntu package manager',
    },
    apk: {
      name: 'APK',
      binary: 'apk',
      // Pre-installed on Alpine Linux.
      installScript: undefined,
      checkCommand: 'apk --version',
      description: 'Alpine Linux package manager',
    },
    dnf: {
      name: 'DNF',
      binary: 'dnf',
      // Pre-installed on Fedora 22+/RHEL 8+.
      installScript: undefined,
      checkCommand: 'dnf --version',
      description: 'Fedora/RHEL 8+ package manager',
    },
    yum: {
      name: 'YUM',
      binary: 'yum',
      // Pre-installed on older RHEL/CentOS.
      installScript: undefined,
      checkCommand: 'yum --version',
      description: 'RHEL/CentOS package manager',
    },
  },
  win32: {
    preferred: 'choco',
    available: ['choco', 'scoop'],
    choco: {
      name: 'Chocolatey',
      binary: 'choco',
      installScript:
        'powershell -NoProfile -ExecutionPolicy Bypass -Command "iex ((New-Object System.Net.WebClient).DownloadString(\'https://chocolatey.org/install.ps1\'))"',
      checkCommand: 'choco --version',
      description: 'Windows package manager',
    },
    scoop: {
      name: 'Scoop',
      binary: 'scoop',
      installScript:
        'powershell -Command "iex (new-object net.webclient).downloadstring(\'https://get.scoop.sh\')"',
      checkCommand: 'scoop --version',
      description: 'Windows command-line installer',
    },
  },
}

/**
 * Detect available package managers on the system.
 *
 * @returns {string[]} Array of available package manager names.
 */
export function detectPackageManagers() {
  const platform = getPlatform()
  const config = PACKAGE_MANAGER_CONFIGS[platform]

  if (!config) {
    return []
  }

  const managers = []

  for (const managerName of config.available) {
    const managerConfig = config[managerName]
    if (whichSync(managerConfig.binary, { nothrow: true })) {
      managers.push(managerName)
    }
  }

  return managers
}

/**
 * Get preferred package manager for current platform.
 *
 * @returns {string|undefined} Preferred package manager name or undefined.
 */
export function getPreferredPackageManager() {
  const platform = getPlatform()
  const config = PACKAGE_MANAGER_CONFIGS[platform]

  return config ? config.preferred : undefined
}

/**
 * Install a package manager.
 *
 * @param {string} managerName - Package manager to install.
 * @param {object} options - Installation options.
 * @param {boolean} options.autoYes - Auto-yes to prompts (default: false).
 * @returns {Promise<boolean>} True if installation succeeded.
 */
export async function installPackageManager(
  managerName,
  { autoYes = false } = {},
) {
  const platform = getPlatform()
  const platformConfig = PACKAGE_MANAGER_CONFIGS[platform]

  if (!platformConfig) {
    printError(`Unsupported platform: ${platform}`)
    return false
  }

  const managerConfig = platformConfig[managerName]
  if (!managerConfig) {
    printError(`Unknown package manager: ${managerName}`)
    return false
  }

  // Check if already installed.
  if (whichSync(managerConfig.binary, { nothrow: true })) {
    logger.info(`${managerConfig.name} is already installed`)
    return true
  }

  // Check if installation script is available.
  if (!managerConfig.installScript) {
    printError(`${managerConfig.name} must be pre-installed on this system`)
    return false
  }

  logger.substep(`Installing ${managerConfig.name}...`)
  logger.warn(
    "This will execute an installation script from the package manager's official source",
  )

  // For non-auto-yes mode, prompt user.
  if (!autoYes) {
    logger.info(`Run: ${managerConfig.installScript}`)
    logger.warn(
      'Please run the above command manually with appropriate permissions',
    )
    return false
  }

  try {
    const shPath = await which('sh', { nothrow: true })
    if (!shPath || Array.isArray(shPath)) {
      printError('sh not found in PATH')
      return false
    }

    const result = await spawn(shPath, ['-c', managerConfig.installScript], {
      env: process.env,
      stdio: 'inherit',
    })

    const exitCode = result.code ?? 0
    if (exitCode !== 0) {
      printError(`Failed to install ${managerConfig.name}`)
      return false
    }

    // Verify installation.
    const installed = whichSync(managerConfig.binary, { nothrow: true })
    if (installed) {
      logger.success(`${managerConfig.name} installed successfully`)
      return true
    }

    logger.warn(
      `${managerConfig.name} installation completed but binary not found`,
    )
    return false
  } catch (e) {
    printError(`Error installing ${managerConfig.name}`, e)
    return false
  }
}

/**
 * Ensure a package manager is available, installing if needed.
 *
 * @param {object} options - Options.
 * @param {boolean} options.autoInstall - Attempt auto-installation (default: false).
 * @param {boolean} options.autoYes - Auto-yes to prompts (default: false).
 * @returns {Promise<{available: boolean, manager: string|undefined, installed: boolean}>}
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
 * Get package manager installation instructions.
 *
 * @returns {string[]} Array of installation instruction strings.
 */
export function getPackageManagerInstructions() {
  const platform = getPlatform()
  const config = PACKAGE_MANAGER_CONFIGS[platform]

  if (!config) {
    return ['Unsupported platform for package manager auto-installation']
  }

  const instructions = []
  const preferred = config[config.preferred]

  instructions.push(`Install ${preferred.name} (${preferred.description}):`)
  if (preferred.installScript) {
    instructions.push(`  ${preferred.installScript}`)
  } else {
    instructions.push('  (Pre-installed on this system)')
  }

  return instructions
}

/**
 * Check if running with elevated privileges (sudo/admin).
 *
 * @returns {Promise<boolean>}
 */
export async function checkElevatedPrivileges() {
  const platform = getPlatform()

  if (platform === 'win32') {
    // On Windows, check if running as administrator.
    try {
      const netPath = await which('net', { nothrow: true })
      if (!netPath || Array.isArray(netPath)) {
        return false
      }
      const result = await spawn(netPath, ['session'], {})
      return result.code === 0
    } catch {
      return false
    }
  }

  // On Unix, check if root user or has sudo access.
  if (process.getuid && process.getuid() === 0) {
    return true
  }

  // Check if sudo is available.
  try {
    const sudoPath = await which('sudo', { nothrow: true })
    if (!sudoPath || Array.isArray(sudoPath)) {
      return false
    }
    const result = await spawn(sudoPath, ['-n', 'true'])
    return result.code === 0
  } catch {
    return false
  }
}

/**
 * Install a tool using the specified package manager.
 *
 * @param {string} tool - Tool name.
 * @param {string} packageManager - Package manager to use.
 * @param {object} options - Installation options.
 * @param {boolean} options.autoYes - Automatically answer yes to prompts.
 * @returns {Promise<boolean>} True if installation succeeded.
 */
export async function installTool(
  tool,
  packageManager,
  { autoYes = false, version } = {},
) {
  const config = getToolConfig(tool)
  if (!config) {
    printError(`Unknown tool: ${tool}`)
    return false
  }

  const platform = getPlatform()
  const packageInfo = config.packages?.[platform]

  if (!packageInfo || !packageInfo[packageManager]) {
    printError(
      `No ${packageManager} package available for ${tool} on ${platform}`,
    )
    return false
  }

  const packageName = packageInfo[packageManager]

  // Get version from pinned-versions.mjs if not provided
  if (!version) {
    // Get version from pinned-versions.mjs (reads from external-tools.json)
    version = getToolVersion(tool, packageManager)
  }

  const versionInfo = version ? ` (version ${version})` : ''
  logger.info(`Installing ${tool}${versionInfo} via ${packageManager}...`)

  try {
    let command
    let args
    const needsSudo =
      platform !== 'win32' &&
      ['apt', 'apk', 'yum', 'dnf'].includes(packageManager)

    switch (packageManager) {
      case 'brew':
        // Homebrew doesn't support version pinning for most formulas
        command = 'brew'
        args = ['install', packageName]
        if (version) {
          logger.warn('Homebrew may not support version pinning for this tool')
        }
        break

      case 'apt': {
        // APT version pinning: package=version
        command = needsSudo ? 'sudo' : 'apt-get'
        const aptPackage = version ? `${packageName}=${version}*` : packageName
        args = needsSudo
          ? ['apt-get', 'install', '-y', aptPackage]
          : ['install', '-y', aptPackage]
        break
      }

      case 'apk': {
        // APK version pinning: package=version
        command = needsSudo ? 'sudo' : 'apk'
        const apkPackage = version ? `${packageName}=${version}` : packageName
        args = needsSudo
          ? ['apk', 'add', '--no-cache', apkPackage]
          : ['add', '--no-cache', apkPackage]
        break
      }

      case 'yum': {
        // YUM version pinning: package-version
        command = needsSudo ? 'sudo' : 'yum'
        const yumPackage = version ? `${packageName}-${version}` : packageName
        args = needsSudo
          ? ['yum', 'install', '-y', yumPackage]
          : ['install', '-y', yumPackage]
        break
      }

      case 'dnf': {
        // DNF version pinning: package-version
        command = needsSudo ? 'sudo' : 'dnf'
        const dnfPackage = version ? `${packageName}-${version}` : packageName
        args = needsSudo
          ? ['dnf', 'install', '-y', dnfPackage]
          : ['install', '-y', dnfPackage]
        break
      }

      case 'choco':
        // Chocolatey version pinning: --version flag
        command = 'choco'
        args = version
          ? ['install', packageName, '--version', version, autoYes ? '-y' : '']
          : [' install', packageName, autoYes ? '-y' : '']
        args = args.filter(Boolean)
        break

      case 'scoop': {
        // Scoop version pinning: package@version
        command = 'scoop'
        const scoopPackage = version ? `${packageName}@${version}` : packageName
        args = ['install', scoopPackage]
        break
      }

      default:
        printError(`Unsupported package manager: ${packageManager}`)
        return false
    }

    // Resolve command path
    const commandPath = await which(command, { nothrow: true })
    if (!commandPath || Array.isArray(commandPath)) {
      printError(`${command} not found in PATH`)
      return false
    }

    const result = await spawn(commandPath, args, {
      env: process.env,
      stdio: 'inherit',
    })

    const exitCode = result.code ?? 0
    if (exitCode !== 0) {
      printError(`Failed to install ${tool} via ${packageManager}`)
      return false
    }

    // Verify installation.
    const installed = whichSync(tool, { nothrow: true })
    if (installed) {
      logger.success(`${tool} installed successfully`)
      return true
    }

    logger.warn(`${tool} installation completed but binary not found in PATH`)
    return false
  } catch (e) {
    printError(`Error installing ${tool}`, e)
    return false
  }
}

/**
 * Ensure a tool is installed, attempting auto-installation if needed.
 *
 * @param {string} tool - Tool name to check/install.
 * @param {object} options - Options.
 * @param {boolean} options.autoInstall - Attempt auto-installation if missing (default: true).
 * @param {boolean} options.autoYes - Automatically answer yes to prompts (default: false).
 * @returns {Promise<{available: boolean, installed: boolean, packageManager: string|undefined}>}
 */
export async function ensureToolInstalled(
  tool,
  { autoInstall = true, autoYes = false } = {},
) {
  // Check if already installed.
  const binPath = whichSync(tool, { nothrow: true })
  if (binPath) {
    return { available: true, installed: false, packageManager: undefined }
  }

  if (!autoInstall) {
    return { available: false, installed: false, packageManager: undefined }
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

  return {
    available: installed,
    installed,
    packageManager: installed ? packageManager : undefined,
  }
}

/**
 * Get installation instructions for a tool.
 *
 * @param {string} tool - Tool name.
 * @returns {string[]} Array of installation instruction strings.
 */
export function getInstallInstructions(tool) {
  const config = getToolConfig(tool)
  if (!config) {
    return [`Unknown tool: ${tool}`]
  }

  const platform = getPlatform()
  const instructions = []

  instructions.push(`Install ${tool} (${config.description}):`)

  if (platform === 'darwin') {
    instructions.push(`  brew install ${config.packages.darwin.brew}`)
  } else if (platform === 'linux') {
    const pkg = config.packages.linux
    if (pkg.apt) {
      instructions.push(`  sudo apt-get install -y ${pkg.apt}`)
    }
    if (pkg.apk) {
      instructions.push(`  sudo apk add --no-cache ${pkg.apk}`)
    }
    if (pkg.yum) {
      instructions.push(`  sudo yum install -y ${pkg.yum}`)
    }
    if (pkg.dnf) {
      instructions.push(`  sudo dnf install -y ${pkg.dnf}`)
    }
  } else if (platform === 'win32') {
    const pkg = config.packages.win32
    if (pkg.choco) {
      instructions.push(`  choco install ${pkg.choco}`)
    }
    if (pkg.scoop) {
      instructions.push(`  scoop install ${pkg.scoop}`)
    }
  }

  return instructions
}

/**
 * Ensure all required tools are installed.
 *
 * @param {string[]} tools - Array of tool names to check.
 * @param {object} options - Options.
 * @param {boolean} options.autoInstall - Attempt auto-installation (default: true).
 * @param {boolean} options.autoYes - Auto-yes to prompts (default: false).
 * @returns {Promise<{allAvailable: boolean, missing: string[], installed: string[]}>}
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
