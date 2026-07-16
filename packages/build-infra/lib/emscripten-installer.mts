/**
 * Emscripten SDK Installation Utilities.
 *
 * Provides utilities for automatically installing and activating Emscripten
 * SDK.
 */

import { existsSync, promises as fs, realpathSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { whichSync } from '@socketsecurity/lib-stable/bin/which'
import { WIN32 } from '@socketsecurity/lib-stable/constants/platform'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { printError } from './build-output.mts'
import { errorMessage } from './error-utils.mts'

const logger = getDefaultLogger()

/**
 * Activate Emscripten SDK environment for current process.
 *
 * @param {object} options - Options.
 * @param {string} options.emsdkPath - Emscripten SDK path (default:
 *   auto-detect).
 * @param {string} options.version - Version to activate (default: 'latest').
 * @param {boolean} options.quiet - Suppress output.
 *
 * @returns {Promise<{ activated: boolean; env: object }>}
 */
export async function activateEmscripten({
  emsdkPath,
  quiet = false,
  version = 'latest',
} = {}) {
  const resolvedEmsdkPath = emsdkPath || getEmsdkPath()

  if (!checkEmsdkInstalled(resolvedEmsdkPath)) {
    if (!quiet) {
      printError(`Emscripten SDK not found at ${resolvedEmsdkPath}`)
    }
    return { activated: false, env: {} }
  }

  try {
    const emsdkCmd = WIN32 ? 'emsdk.bat' : './emsdk'

    // Activate the version.
    if (!quiet) {
      logger.info(`Activating Emscripten ${version}...`)
    }

    const activateResult = await spawn(emsdkCmd, ['activate', version], {
      cwd: resolvedEmsdkPath,
      env: getEmsdkSpawnEnv(),
      shell: WIN32,
      stdio: quiet ? 'pipe' : 'inherit',
    })

    if (activateResult.code !== 0) {
      if (!quiet) {
        printError(`Failed to activate Emscripten ${version}`)
      }
      return { activated: false, env: {} }
    }

    // Source the environment (construct_env).
    const constructEnvCmd = WIN32 ? 'emsdk_env.bat' : './emsdk_env.sh'
    const constructResult = await spawn(
      WIN32 ? constructEnvCmd : 'bash',
      WIN32 ? [] : ['-c', `source ${constructEnvCmd} && env`],
      {
        cwd: resolvedEmsdkPath,
        env: getEmsdkSpawnEnv(),
        shell: WIN32,
      },
    )

    if (constructResult.code !== 0) {
      if (!quiet) {
        logger.warn('Failed to source Emscripten environment')
      }
    }

    // Parse environment variables from output.
    const envVars = {}
    if (constructResult.stdout) {
      const lines = constructResult.stdout.toString().split('\n')
      for (let i = 0, { length } = lines; i < length; i += 1) {
        const line = lines[i]
        // ^(?<key>\w+): env var name; =: separator; (?<value>.*): value to
        // end of line. Both groups MUST capture — key/value are read below.
        const match = line.match(/^(?<key>\w+)=(?<value>.*)$/)
        if (match) {
          const { key, value } = match.groups
          if (key === 'PATH' || key === 'EMSDK' || key.startsWith('EM_')) {
            envVars[key] = value
          }
        }
      }
    }

    // Ensure critical environment variables are set even if parsing failed.
    if (!envVars.EMSDK) {
      envVars.EMSDK = resolvedEmsdkPath
    }
    if (!envVars.EMSCRIPTEN) {
      envVars.EMSCRIPTEN = path.join(
        resolvedEmsdkPath,
        'upstream',
        'emscripten',
      )
    }

    // Apply to current process environment.
    Object.assign(process.env, envVars)

    if (!quiet) {
      logger.success(`Emscripten ${version} activated`)
    }

    return { activated: true, env: envVars }
  } catch (e) {
    if (!quiet) {
      printError(`Error activating Emscripten: ${errorMessage(e)}`)
    }
    return { activated: false, env: {} }
  }
}

/**
 * Check if Emscripten is available.
 *
 * @returns {boolean} True if emcc is in PATH.
 */
export function checkEmscriptenAvailable() {
  return Boolean(whichSync('emcc', { nothrow: true }))
}

/**
 * Check if Emscripten SDK is installed at the given path.
 *
 * @param {string} emsdkPath - Path to emsdk directory.
 *
 * @returns {boolean} True if emsdk exists at path.
 */
export function checkEmsdkInstalled(emsdkPath = getEmsdkPath()) {
  return (
    existsSync(path.join(emsdkPath, 'emsdk')) ||
    existsSync(path.join(emsdkPath, 'emsdk.bat'))
  )
}

/**
 * Ensure Emscripten is available, installing if needed.
 *
 * @param {object} options - Options.
 * @param {string} options.version - Version to install (default: 'latest').
 * @param {string} options.installPath - Installation path (default:
 *   auto-detect).
 * @param {boolean} options.autoInstall - Attempt auto-installation (default:
 *   true).
 * @param {boolean} options.quiet - Suppress output (default: false).
 *
 * @returns {Promise<{
 *   available: boolean
 *   installed: boolean
 *   activated: boolean
 * }>}
 */
export async function ensureEmscripten({
  autoInstall = true,
  installPath,
  quiet = false,
  version = 'latest',
} = {}) {
  // Check if emcc is already in PATH.
  if (checkEmscriptenAvailable()) {
    // emcc is available, but we still need to ensure EMSDK/EMSCRIPTEN env vars are set
    // for downstream tools like CMake that need to locate the toolchain file.
    const emsdkPath = installPath || getEmsdkPath()
    if (!process.env['EMSDK'] && checkEmsdkInstalled(emsdkPath)) {
      process.env['EMSDK'] = emsdkPath
    }
    if (!process.env['EMSCRIPTEN']) {
      // Try to derive EMSCRIPTEN from EMSDK or emcc location
      if (process.env['EMSDK']) {
        process.env['EMSCRIPTEN'] = path.join(
          process.env['EMSDK'],
          'upstream',
          'emscripten',
        )
      } else {
        // Try to find it from emcc path
        const emccPath = whichSync('emcc', { nothrow: true })
        if (emccPath) {
          // emcc could be a symlink (e.g., Homebrew) - resolve it
          const resolvedEmcc = existsSync(emccPath)
            ? realpathSync(emccPath)
            : emccPath
          // emcc is at EMSCRIPTEN/emcc, so get parent directory
          const emscriptenPath = path.dirname(resolvedEmcc)
          process.env['EMSCRIPTEN'] = emscriptenPath
          // Also try to set EMSDK (EMSCRIPTEN is at EMSDK/upstream/emscripten)
          if (!process.env['EMSDK']) {
            const possibleEmsdk = path.resolve(emscriptenPath, '..', '..')
            if (checkEmsdkInstalled(possibleEmsdk)) {
              process.env['EMSDK'] = possibleEmsdk
            }
          }
        }
      }
    }
    return { activated: false, available: true, installed: false }
  }

  const emsdkPath = installPath || getEmsdkPath()

  // Check if emsdk is installed but not activated.
  if (checkEmsdkInstalled(emsdkPath)) {
    if (!quiet) {
      logger.substep('Emscripten SDK found, activating…')
    }
    let activation = await activateEmscripten({
      emsdkPath,
      quiet,
      version,
    })
    let repaired = false
    if (!activation.activated && autoInstall) {
      // An emsdk checkout can exist while the requested version's tools are
      // missing — an interrupted `emsdk install`, or a sibling build process
      // cloned the SDK moments ago and is still installing. Activate then
      // fails with "tool is not installed and therefore cannot be
      // activated". `emsdk install` is idempotent (already-installed tools
      // are skipped), so install the version and retry activation once.
      if (!quiet) {
        logger.substep(
          `Activation failed — running emsdk install ${version} and retrying…`,
        )
      }
      repaired = await installEmsdkVersion({ emsdkPath, quiet, version })
      if (repaired) {
        activation = await activateEmscripten({ emsdkPath, quiet, version })
      }
    }
    return {
      activated: activation.activated,
      available: activation.activated,
      installed: repaired,
    }
  }

  if (!autoInstall) {
    return { activated: false, available: false, installed: false }
  }

  // Install Emscripten SDK.
  if (!quiet) {
    logger.substep('Emscripten not found, installing…')
  }

  const installed = await installEmscripten({
    installPath: emsdkPath,
    quiet,
    version,
  })
  if (!installed) {
    return { activated: false, available: false, installed: false }
  }

  // Activate after installation.
  const activation = await activateEmscripten({
    emsdkPath,
    quiet,
    version,
  })

  return {
    activated: activation.activated,
    available: activation.activated,
    installed: true,
  }
}

/**
 * Default Emscripten SDK installation path.
 */
export function getDefaultEmsdkPath() {
  return path.join(os.homedir(), '.emsdk')
}

/**
 * Get Emscripten installation instructions.
 *
 * @param {object} options - Options.
 * @param {string} options.installPath - Installation path suggestion.
 *
 * @returns {string[]} Array of installation instruction strings.
 */
export function getEmscriptenInstructions({ installPath } = {}) {
  const emsdkPath = installPath || getDefaultEmsdkPath()
  return [
    'Install Emscripten SDK:',
    `  git clone https://github.com/emscripten-core/emsdk.git ${emsdkPath}`,
    `  cd ${emsdkPath}`,
    '  ./emsdk install latest',
    '  ./emsdk activate latest',
    `  source ${emsdkPath}/emsdk_env.sh`,
  ]
}

/**
 * Get Emscripten SDK path from environment or default location.
 *
 * @returns {string} Emscripten SDK path.
 */
export function getEmsdkPath() {
  return process.env['EMSDK'] || getDefaultEmsdkPath()
}

/**
 * Environment for emsdk invocations. emsdk drives its downloads through
 * whatever `python3` it resolves, and a non-system python without CA-store
 * wiring fails every fetch with "[SSL: CERTIFICATE_VERIFY_FAILED] ...
 * unable to get local issuer certificate" (emscripten-core/emsdk#1358) —
 * the recurring "tool is not installed" activate failure in CI is that
 * failed node download. Pin EMSDK_PYTHON to the system python and point
 * SSL_CERT_FILE/SSL_CERT_DIR at the distro CA bundle when present; every
 * override is skipped if the caller already set it.
 *
 * @returns {object} Environment variables for emsdk spawns.
 */
export function getEmsdkSpawnEnv() {
  const env = { ...process.env }
  // Linux only — macOS and Windows resolve a python that verifies fine
  // today, and overriding EMSDK_PYTHON / SSL vars there risks regressing a
  // working setup (macOS /etc/ssl/certs is empty, its system python has its
  // own CA wiring).
  if (process.platform === 'linux') {
    if (!env['EMSDK_PYTHON'] && existsSync('/usr/bin/python3')) {
      env['EMSDK_PYTHON'] = '/usr/bin/python3'
    }
    // Debian/Ubuntu (and most glibc distro) CA bundle path.
    const caBundle = '/etc/ssl/certs/ca-certificates.crt'
    if (!env['SSL_CERT_FILE'] && existsSync(caBundle)) {
      env['SSL_CERT_FILE'] = caBundle
    }
  }
  return env
}

/**
 * Install Emscripten SDK.
 *
 * @param {object} options - Installation options.
 * @param {string} options.version - Version to install (default: 'latest').
 * @param {string} options.installPath - Installation path (default: ~/.emsdk).
 * @param {boolean} options.quiet - Suppress output.
 *
 * @returns {Promise<boolean>} True if installation succeeded.
 */
export async function installEmscripten({
  installPath,
  quiet = false,
  version = 'latest',
} = {}) {
  const emsdkPath = installPath || getDefaultEmsdkPath()

  // Check if git is available.
  if (!whichSync('git', { nothrow: true })) {
    if (!quiet) {
      printError('git is required to install Emscripten SDK')
    }
    return false
  }

  try {
    // Create parent directory.
    await fs.mkdir(emsdkPath, { recursive: true })

    // Clone emsdk repository.
    if (!quiet) {
      logger.substep(`Cloning Emscripten SDK to ${emsdkPath}...`)
    }

    const cloneResult = await spawn(
      'git',
      ['clone', 'https://github.com/emscripten-core/emsdk.git', emsdkPath],
      {
        env: process.env,
        stdio: quiet ? 'pipe' : 'inherit',
      },
    )

    if (cloneResult.code !== 0) {
      if (!quiet) {
        printError('Failed to clone Emscripten SDK')
      }
      return false
    }

    // Run emsdk install.
    if (!quiet) {
      logger.info(`Installing Emscripten ${version}...`)
    }

    const installed = await installEmsdkVersion({
      emsdkPath,
      quiet,
      version,
    })

    if (!installed) {
      if (!quiet) {
        printError(`Failed to install Emscripten ${version}`)
      }
      return false
    }

    // Activate the installed version.
    const emsdkCmd = WIN32 ? 'emsdk.bat' : './emsdk'
    if (!quiet) {
      logger.info(`Activating Emscripten ${version}...`)
    }

    const activateResult = await spawn(emsdkCmd, ['activate', version], {
      cwd: emsdkPath,
      env: getEmsdkSpawnEnv(),
      shell: WIN32,
      stdio: quiet ? 'pipe' : 'inherit',
    })

    if (activateResult.code !== 0) {
      if (!quiet) {
        printError(`Failed to activate Emscripten ${version}`)
      }
      return false
    }

    if (!quiet) {
      logger.success(`Emscripten SDK ${version} installed successfully`)
      logger.warn(`Add to your environment: source ${emsdkPath}/emsdk_env.sh`)
    }

    return true
  } catch (e) {
    if (!quiet) {
      printError(`Error installing Emscripten: ${errorMessage(e)}`)
    }
    return false
  }
}

/**
 * Run `emsdk install <version>` inside an existing SDK checkout. Idempotent —
 * emsdk skips tools that are already installed, so this is safe to run as a
 * repair step when activation finds the version's tools missing.
 *
 * @param {object} options - Options.
 * @param {string} options.emsdkPath - Emscripten SDK path (default:
 *   auto-detect).
 * @param {boolean} options.quiet - Suppress output.
 * @param {string} options.version - Version to install (default: 'latest').
 *
 * @returns {Promise<boolean>} True if the install succeeded.
 */
export async function installEmsdkVersion({
  emsdkPath,
  quiet = false,
  version = 'latest',
} = {}) {
  const resolvedEmsdkPath = emsdkPath || getEmsdkPath()
  const emsdkCmd = WIN32 ? 'emsdk.bat' : './emsdk'
  try {
    const installResult = await spawn(emsdkCmd, ['install', version], {
      cwd: resolvedEmsdkPath,
      env: getEmsdkSpawnEnv(),
      shell: WIN32,
      stdio: quiet ? 'pipe' : 'inherit',
    })
    return installResult.code === 0
  } catch (e) {
    if (!quiet) {
      printError(`Error installing Emscripten ${version}: ${errorMessage(e)}`)
    }
    return false
  }
}
