/**
 * Tool installer primitives — install/verify operations.
 *
 * Houses the package-manager install and tool verification functions.
 * Split from tool-installer.mts to keep each file under the 500-line
 * soft cap.
 */

import path from 'node:path'
import process from 'node:process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { WIN32 } from '@socketsecurity/lib-stable/constants/platform'
import binPkg, { which } from '@socketsecurity/lib-stable/bin/which'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { getPlatform } from './build-env.mts'
import { printError } from './build-output.mts'
import { getToolConfig, getToolVersion } from './pinned-versions.mts'
import {
  KEG_ONLY_FORMULAS,
  PACKAGE_MANAGER_CONFIGS,
} from './tool-installer-config.mts'

const { whichSync } = binPkg
const logger = getDefaultLogger()
const __dirname = path.dirname(fileURLToPath(import.meta.url))

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
 * Install a package manager.
 *
 * @param {string} managerName - Package manager to install.
 * @param {object} options - Installation options.
 * @param {boolean} options.autoYes - Auto-yes to prompts (default: false).
 *
 * @returns {Promise<boolean>} True if installation succeeded.
 */
// oxlint-disable-next-line socket/sort-source-methods -- ordered by install pipeline phase (install package manager → install tool → resolve pinned → verify); alphabetizing across phases would scatter the flow.
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
 * Install a tool using the specified package manager.
 *
 * @param {string} tool - Tool name.
 * @param {string} packageManager - Package manager to use.
 * @param {object} options - Installation options.
 * @param {boolean} options.autoYes - Automatically answer yes to prompts.
 *
 * @returns {Promise<boolean>} True if installation succeeded.
 */
// oxlint-disable-next-line socket/sort-source-methods -- ordered by install pipeline phase (install package manager → install tool → resolve pinned → verify); alphabetizing across phases would scatter the flow.
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
  const packageName = tool

  // Get version from pinned-versions.mts if not provided
  if (!version) {
    version = getToolVersion(tool)
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
      case 'brew': {
        // Homebrew doesn't support version pinning for most formulas
        command = 'brew'
        args = ['install', packageName]
        if (version) {
          logger.warn('Homebrew may not support version pinning for this tool')
        }
        break
      }

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

      case 'choco': {
        // Chocolatey version pinning: --version flag
        command = 'choco'
        args = version
          ? ['install', packageName, '--version', version, autoYes ? '-y' : '']
          : ['install', packageName, autoYes ? '-y' : '']
        args = args.filter(Boolean)
        break
      }

      case 'scoop': {
        // Scoop version pinning: package@version
        command = 'scoop'
        const scoopPackage = version ? `${packageName}@${version}` : packageName
        args = ['install', scoopPackage]
        break
      }

      default: {
        printError(`Unsupported package manager: ${packageManager}`)
        return false
      }
    }

    // Resolve command path
    const commandPath = await which(command, { nothrow: true })
    if (!commandPath || Array.isArray(commandPath)) {
      printError(`${command} not found in PATH`)
      return false
    }

    const result = await spawn(commandPath, args, {
      env: { ...process.env, HOMEBREW_NO_ANALYTICS: '1' },
      stdio: 'inherit',
    })

    const exitCode = result.code ?? 0
    if (exitCode !== 0) {
      printError(`Failed to install ${tool} via ${packageManager}`)
      return false
    }

    // Brew "keg-only" formulas (openssl@3, libpq, libffi, etc.) install
    // without symlinking into /opt/homebrew/lib so they don't conflict
    // with the system equivalent. That leaves consumers like rustc /
    // cargo unable to load `libssl.3.dylib` at runtime even though the
    // file exists in the cellar. `brew install` is silent on this state
    // — it just prints "already installed, it's just not linked" and
    // exits 0. Force-link after install so dependent tools can dlopen
    // the homebrew copy. Only on macOS, only for brew, only for the
    // formulas where it's load-bearing.
    if (packageManager === 'brew' && KEG_ONLY_FORMULAS.has(packageName)) {
      const linkResult = await spawn(
        commandPath,
        ['link', '--overwrite', '--force', packageName],
        {
          env: { ...process.env, HOMEBREW_NO_ANALYTICS: '1' },
          stdio: 'inherit',
        },
      )
      if ((linkResult.code ?? 0) !== 0) {
        logger.warn(
          `${packageName} installed but \`brew link --overwrite --force\` failed; dependent tools may fail to load it`,
        )
      }
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
 * Resolve a pinned tool's artifact info from
 * tool-checksums/<tool>-<version>.json. No separate resolver module needed —
 * the checksum JSON has everything.
 *
 * @param {string} tool - Tool name.
 * @param {string} version - Required version.
 *
 * @returns {{
 *       url: string
 *       sha256: string
 *       extractDir: string
 *       binary: string
 *       archiveFormat: string
 *     }
 *   | undefined}
 */
// oxlint-disable-next-line socket/sort-source-methods -- ordered by install pipeline phase (install package manager → install tool → resolve pinned → verify); alphabetizing across phases would scatter the flow.
export function resolvePinnedArtifact(tool, version) {
  const archMap = { __proto__: null, arm64: 'aarch64', x64: 'x86_64' }
  const osMap = {
    __proto__: null,
    darwin: 'macos',
    linux: 'linux',
    win32: 'windows',
  }
  const target = `${archMap[process.arch] || process.arch}-${osMap[process.platform] || process.platform}`

  const checksumFile = path.join(
    __dirname,
    '..',
    'tool-checksums',
    `${tool}-${version}.json`,
  )
  try {
    const data = JSON.parse(readFileSync(checksumFile, 'utf8'))
    const artifact = data.artifacts[target]
    if (!artifact) {
      return undefined
    }
    return {
      ...artifact,
      binary: WIN32 ? `${tool}.exe` : tool,
      archiveFormat: artifact.url.endsWith('.zip') ? 'zip' : 'tar.xz',
    }
  } catch {
    return undefined
  }
}

/**
 * Verify a tool actually works by running verification args.
 *
 * This catches cases where the binary exists but has broken dependencies
 * (e.g., llvm-strip with missing z3 library on macOS).
 *
 * @param {string} tool - Tool name.
 * @param {string[]} [verifyArgs] - Args to run for verification (default:
 *   ['--version'])
 *
 * @returns {Promise<boolean>} True if tool runs successfully
 */
// oxlint-disable-next-line socket/sort-source-methods -- ordered by install pipeline phase (install package manager → install tool → resolve pinned → verify); alphabetizing across phases would scatter the flow.
export async function verifyToolWorks(tool, verifyArgs = ['--version']) {
  const binPath = whichSync(tool, { nothrow: true })
  if (!binPath) {
    return false
  }
  try {
    const result = await spawn(binPath, verifyArgs, { stdio: 'pipe' })
    return result.code === 0
  } catch {
    return false
  }
}
