/**
 * Emscripten SDK Installation Utilities
 *
 * Provides utilities for automatically installing and activating Emscripten SDK.
 */

import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import binPkg from '@socketsecurity/lib/bin'
import platformPkg from '@socketsecurity/lib/constants/platform'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import spawnPkg from '@socketsecurity/lib/spawn'

import { printError } from './build-output.mjs'

const logger = getDefaultLogger()
const { whichSync } = binPkg
const { WIN32 } = platformPkg
const { spawn } = spawnPkg

/**
 * Default Emscripten SDK installation path.
 */
export function getDefaultEmsdkPath() {
  return join(homedir(), '.emsdk')
}

/**
 * Check if Emscripten is available.
 *
 * @returns {boolean} True if emcc is in PATH.
 */
export function checkEmscriptenAvailable() {
  return !!whichSync('emcc', { nothrow: true })
}

/**
 * Get Emscripten SDK path from environment or default location.
 *
 * @returns {string} Emscripten SDK path.
 */
export function getEmsdkPath() {
  return process.env.EMSDK || getDefaultEmsdkPath()
}

/**
 * Check if Emscripten SDK is installed at the given path.
 *
 * @param {string} emsdkPath - Path to emsdk directory.
 * @returns {boolean} True if emsdk exists at path.
 */
export function checkEmsdkInstalled(emsdkPath = getEmsdkPath()) {
  return (
    existsSync(join(emsdkPath, 'emsdk')) ||
    existsSync(join(emsdkPath, 'emsdk.bat'))
  )
}

/**
 * Install Emscripten SDK.
 *
 * @param {object} options - Installation options.
 * @param {string} options.version - Version to install (default: 'latest').
 * @param {string} options.path - Installation path (default: ~/.emsdk).
 * @param {boolean} options.quiet - Suppress output.
 * @returns {Promise<boolean>} True if installation succeeded.
 */
export async function installEmscripten({
  path,
  quiet = false,
  version = 'latest',
} = {}) {
  const emsdkPath = path || getDefaultEmsdkPath()

  // Check if git is available.
  if (!whichSync('git', { nothrow: true })) {
    if (!quiet) {
      printError('git is required to install Emscripten SDK')
    }
    return false
  }

  try {
    // Create parent directory.
    await mkdir(emsdkPath, { recursive: true })

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
    const emsdkCmd = WIN32 ? 'emsdk.bat' : './emsdk'
    if (!quiet) {
      logger.info(`Installing Emscripten ${version}...`)
    }

    const installResult = await spawn(emsdkCmd, ['install', version], {
      cwd: emsdkPath,
      env: process.env,
      shell: WIN32,
      stdio: quiet ? 'pipe' : 'inherit',
    })

    if (installResult.code !== 0) {
      if (!quiet) {
        printError(`Failed to install Emscripten ${version}`)
      }
      return false
    }

    // Activate the installed version.
    if (!quiet) {
      logger.info(`Activating Emscripten ${version}...`)
    }

    const activateResult = await spawn(emsdkCmd, ['activate', version], {
      cwd: emsdkPath,
      env: process.env,
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
      printError(`Error installing Emscripten: ${e.message}`)
    }
    return false
  }
}

/**
 * Activate Emscripten SDK environment for current process.
 *
 * @param {object} options - Options.
 * @param {string} options.path - Emscripten SDK path (default: auto-detect).
 * @param {string} options.version - Version to activate (default: 'latest').
 * @param {boolean} options.quiet - Suppress output.
 * @returns {Promise<{activated: boolean, env: object}>}
 */
export async function activateEmscripten({
  path,
  quiet = false,
  version = 'latest',
} = {}) {
  const emsdkPath = path || getEmsdkPath()

  if (!checkEmsdkInstalled(emsdkPath)) {
    if (!quiet) {
      printError(`Emscripten SDK not found at ${emsdkPath}`)
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
      cwd: emsdkPath,
      env: process.env,
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
        cwd: emsdkPath,
        env: process.env,
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
      for (const line of lines) {
        const match = line.match(/^(\w+)=(.*)$/)
        if (match) {
          const [, key, value] = match
          if (key === 'PATH' || key === 'EMSDK' || key.startsWith('EM_')) {
            envVars[key] = value
          }
        }
      }
    }

    // Ensure critical environment variables are set even if parsing failed.
    if (!envVars.EMSDK) {
      envVars.EMSDK = emsdkPath
    }
    if (!envVars.EMSCRIPTEN) {
      envVars.EMSCRIPTEN = join(emsdkPath, 'upstream', 'emscripten')
    }

    // Apply to current process environment.
    Object.assign(process.env, envVars)

    if (!quiet) {
      logger.success(`Emscripten ${version} activated`)
    }

    return { activated: true, env: envVars }
  } catch (e) {
    if (!quiet) {
      printError(`Error activating Emscripten: ${e.message}`)
    }
    return { activated: false, env: {} }
  }
}

/**
 * Ensure Emscripten is available, installing if needed.
 *
 * @param {object} options - Options.
 * @param {string} options.version - Version to install (default: 'latest').
 * @param {string} options.path - Installation path (default: auto-detect).
 * @param {boolean} options.autoInstall - Attempt auto-installation (default: true).
 * @param {boolean} options.quiet - Suppress output (default: false).
 * @returns {Promise<{available: boolean, installed: boolean, activated: boolean}>}
 */
export async function ensureEmscripten({
  autoInstall = true,
  path,
  quiet = false,
  version = 'latest',
} = {}) {
  // Check if emcc is already in PATH.
  if (checkEmscriptenAvailable()) {
    return { available: true, installed: false, activated: false }
  }

  const emsdkPath = path || getEmsdkPath()

  // Check if emsdk is installed but not activated.
  if (checkEmsdkInstalled(emsdkPath)) {
    if (!quiet) {
      logger.substep('Emscripten SDK found, activating...')
    }
    const activation = await activateEmscripten({
      path: emsdkPath,
      version,
      quiet,
    })
    return {
      available: activation.activated,
      installed: false,
      activated: activation.activated,
    }
  }

  if (!autoInstall) {
    return { available: false, installed: false, activated: false }
  }

  // Install Emscripten SDK.
  if (!quiet) {
    logger.substep('Emscripten not found, installing...')
  }

  const installed = await installEmscripten({ version, path: emsdkPath, quiet })
  if (!installed) {
    return { available: false, installed: false, activated: false }
  }

  // Activate after installation.
  const activation = await activateEmscripten({
    path: emsdkPath,
    version,
    quiet,
  })

  return {
    available: activation.activated,
    installed: true,
    activated: activation.activated,
  }
}

/**
 * Get Emscripten installation instructions.
 *
 * @param {object} options - Options.
 * @param {string} options.path - Installation path suggestion.
 * @returns {string[]} Array of installation instruction strings.
 */
export function getEmscriptenInstructions({ path } = {}) {
  const emsdkPath = path || getDefaultEmsdkPath()
  return [
    'Install Emscripten SDK:',
    `  git clone https://github.com/emscripten-core/emsdk.git ${emsdkPath}`,
    `  cd ${emsdkPath}`,
    '  ./emsdk install latest',
    '  ./emsdk activate latest',
    `  source ${emsdkPath}/emsdk_env.sh`,
  ]
}
