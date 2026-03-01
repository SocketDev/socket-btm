/**
 * Build Environment Detection and Setup
 *
 * Provides utilities for detecting and activating build toolchains:
 * - Emscripten SDK detection and activation
 * - Rust toolchain verification
 * - Python version checking
 * - CI environment detection
 * - Auto-setup and error recovery
 *
 * Used by all builder packages for consistent environment handling.
 */

import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { envAsBoolean } from '@socketsecurity/lib/env'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

import {
  DOCKER_ENV_FILE,
  getEmsdkSearchPaths,
  HOMEBREW_CELLAR_EMSCRIPTEN_PATTERN,
  PODMAN_ENV_FILE,
} from './constants.mjs'
import { getMinPythonVersion } from './version-helpers.mjs'

const logger = getDefaultLogger()

/**
 * Check if building from source is required for a given flag type.
 *
 * @param {'TOOLS' | 'DEPS' | 'ALL'} flagType - The type of build flag to check.
 * @returns {boolean} True if building from source is required.
 */
export function shouldBuildFromSource(flagType) {
  const buildAllFromSource = envAsBoolean(process.env.BUILD_ALL_FROM_SOURCE)
  if (buildAllFromSource) {
    return true
  }
  if (flagType === 'ALL') {
    return false
  }
  return envAsBoolean(process.env[`BUILD_${flagType}_FROM_SOURCE`])
}

/**
 * Throw an error if download is blocked by BUILD_*_FROM_SOURCE flags.
 * Use this at the start of download functions to enforce build-from-source policy.
 *
 * @param {string} toolName - Name of the tool being downloaded.
 * @param {'TOOLS' | 'DEPS'} flagType - The type of build flag to check.
 * @param {object} options - Options for customizing the error message.
 * @param {string} [options.buildCommand] - Custom build command suggestion.
 * @throws {Error} If download is blocked by environment flags.
 */
export function checkBuildSourceFlag(toolName, flagType, options = {}) {
  if (!shouldBuildFromSource(flagType)) {
    return
  }
  const flagName = `BUILD_${flagType}_FROM_SOURCE`
  const buildCommand = options.buildCommand || `pnpm --filter ${toolName} build`
  throw new Error(
    `${toolName} download blocked by ${flagName}=true.\n` +
      `Build ${toolName} locally first:\n` +
      `  ${buildCommand}\n` +
      `Or unset ${flagName} to allow downloading from releases.`,
  )
}

/**
 * Get all build source flags as an object.
 *
 * @returns {{buildAllFromSource: boolean, buildToolsFromSource: boolean, buildDepsFromSource: boolean}}
 */
export function getBuildSourceFlags() {
  const buildAllFromSource = envAsBoolean(process.env.BUILD_ALL_FROM_SOURCE)
  return {
    buildAllFromSource,
    buildDepsFromSource:
      buildAllFromSource || envAsBoolean(process.env.BUILD_DEPS_FROM_SOURCE),
    buildToolsFromSource:
      buildAllFromSource || envAsBoolean(process.env.BUILD_TOOLS_FROM_SOURCE),
  }
}

/**
 * Detect if running in Docker.
 */
export function isDocker() {
  return existsSync(DOCKER_ENV_FILE) || existsSync(PODMAN_ENV_FILE)
}

/**
 * Get platform identifier.
 */
export function getPlatform() {
  return os.platform()
}

/**
 * Check if command exists.
 */
export async function commandExists(cmd) {
  try {
    const isWin32 = getPlatform() === 'win32'
    const checkCommand = isWin32 ? 'where' : 'which'
    await spawn(checkCommand, [cmd], { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

/**
 * Get command output.
 */
export async function getCommandOutput(cmd, args = []) {
  try {
    const { stdout } = await spawn(cmd, args, { stdio: 'pipe' })
    return stdout.trim()
  } catch {
    return ''
  }
}

/**
 * Find Emscripten SDK installation.
 *
 * Searches common locations and returns path if found.
 * Returns object with { path, type } where type is 'emsdk' or 'homebrew'.
 */
export async function findEmscriptenSDK() {
  // Check if EMSDK environment variable is already set.
  if (process.env.EMSDK && existsSync(process.env.EMSDK)) {
    return { path: process.env.EMSDK, type: 'emsdk' }
  }

  // Try to find EMSDK path from emcc location if it's in PATH.
  if (await commandExists('emcc')) {
    try {
      const isWin32 = getPlatform() === 'win32'
      const whichCommand = isWin32 ? 'where' : 'which'
      let emccPath = await getCommandOutput(whichCommand, ['emcc'])

      if (emccPath) {
        // Resolve symlinks to get the real path.
        // Homebrew emcc is typically a symlink.
        const platform = getPlatform()
        if (platform !== 'win32' && existsSync(emccPath)) {
          try {
            // Try readlink -f first, fallback to readlink
            let realPath
            try {
              realPath = await getCommandOutput('readlink', ['-f', emccPath])
            } catch {
              realPath = await getCommandOutput('readlink', [emccPath])
            }
            if (realPath) {
              emccPath = realPath
            }
          } catch {
            // If readlink fails, continue with original path.
          }
        }

        // Check if this is a Homebrew installation.
        // Homebrew: /opt/homebrew/Cellar/emscripten/VERSION/bin/emcc
        // Standard: EMSDK/upstream/emscripten/emcc
        if (emccPath.includes(HOMEBREW_CELLAR_EMSCRIPTEN_PATTERN)) {
          // Homebrew installation - extract the Cellar path.
          const match = emccPath.match(/(.*\/Cellar\/emscripten\/[^/]+)/)
          if (match) {
            const homebrewPath = match[1]
            // Verify Emscripten.cmake exists.
            const cmakeFile = path.join(
              homebrewPath,
              'libexec/cmake/Modules/Platform/Emscripten.cmake',
            )
            if (existsSync(cmakeFile)) {
              return { path: homebrewPath, type: 'homebrew' }
            }
          }
        }

        // Try standard EMSDK structure.
        // emcc is typically at EMSDK/upstream/emscripten/emcc
        // Navigate up: emcc -> emscripten -> upstream -> EMSDK
        const emscriptenDir = path.dirname(emccPath)
        const upstreamDir = path.dirname(emscriptenDir)
        const emsdkPath = path.dirname(upstreamDir)

        const emsdkScript = path.join(
          emsdkPath,
          getPlatform() === 'win32' ? 'emsdk.bat' : 'emsdk',
        )

        if (existsSync(emsdkScript)) {
          return { path: emsdkPath, type: 'emsdk' }
        }
      }
    } catch {
      // Can't determine EMSDK path from emcc location.
    }
  }

  // Search common installation locations.
  const searchPaths = getEmsdkSearchPaths(getPlatform())

  for (const emsdkPath of searchPaths) {
    const emsdkScript = path.join(
      emsdkPath,
      getPlatform() === 'win32' ? 'emsdk.bat' : 'emsdk',
    )

    if (existsSync(emsdkScript)) {
      return { path: emsdkPath, type: 'emsdk' }
    }
  }

  return undefined
}

/**
 * Activate Emscripten SDK.
 *
 * Sets environment variables for current process to use Emscripten.
 * Returns true if successful, false otherwise.
 */
export async function activateEmscriptenSDK() {
  const emsdkInfo = await findEmscriptenSDK()

  if (!emsdkInfo) {
    return false
  }

  const { path: emsdkPath, type } = emsdkInfo

  try {
    // For Homebrew installations, just set EMSDK environment variable.
    // emcc is already in PATH, no need to source scripts.
    if (type === 'homebrew') {
      process.env.EMSDK = emsdkPath
      process.env.EMSCRIPTEN = path.join(emsdkPath, 'libexec')
      return await commandExists('emcc')
    }

    // For standard EMSDK installations, source the environment script.
    const platform = getPlatform()

    if (platform === 'win32') {
      // On Windows, run emsdk_env.bat and capture environment.
      const envScript = path.join(emsdkPath, 'emsdk_env.bat')
      if (!existsSync(envScript)) {
        return false
      }

      // Run emsdk_env.bat and capture resulting environment.
      const { stdout: envOutput } = await spawn(
        'cmd',
        ['/c', `"${envScript}" && set`],
        { stdio: 'pipe' },
      )

      // Parse environment variables.
      const envLines = envOutput.split('\n')
      for (const line of envLines) {
        const match = line.match(/^(EMSDK|EM_\w+|PATH)=(.*)$/)
        if (match) {
          process.env[match[1]] = match[2].trim()
        }
      }
    } else {
      // On Unix, source emsdk_env.sh and capture environment.
      const envScript = path.join(emsdkPath, 'emsdk_env.sh')
      if (!existsSync(envScript)) {
        return false
      }

      // Run bash to source script and print environment.
      const { stdout: envOutput } = await spawn(
        'bash',
        ['-c', `source ${envScript} > /dev/null 2>&1 && env`],
        { stdio: 'pipe' },
      )

      // Parse environment variables.
      const envLines = envOutput.split('\n')
      for (const line of envLines) {
        const match = line.match(/^(EMSDK|EM_\w+|PATH)=(.*)$/)
        if (match) {
          process.env[match[1]] = match[2].trim()
        }
      }
    }

    // Verify emcc is now available and EMSDK is set.
    return (await commandExists('emcc')) && !!process.env.EMSDK
  } catch (error) {
    logger.fail(`Failed to activate Emscripten: ${error.message}`)
    return false
  }
}

/**
 * Get Emscripten version.
 */
export async function getEmscriptenVersion() {
  if (!(await commandExists('emcc'))) {
    return undefined
  }

  try {
    const version = await getCommandOutput('emcc', ['--version'])
    const match = version.match(/emcc.*?(\d+\.\d+\.\d+)/)
    return match ? match[1] : undefined
  } catch {
    return undefined
  }
}

/**
 * Check if Rust is available with WASM support.
 */
export async function checkRust() {
  if (!(await commandExists('rustc'))) {
    return { available: false, reason: 'rustc not found' }
  }

  const version = await getCommandOutput('rustc', ['--version'])
  const match = version.match(/rustc (\d+\.\d+\.\d+)/)

  if (!match) {
    return { available: false, reason: 'version detection failed' }
  }

  // Check for WASM target.
  const targets = await getCommandOutput('rustup', [
    'target',
    'list',
    '--installed',
  ])
  if (!targets.includes('wasm32-unknown-unknown')) {
    return {
      available: false,
      reason: 'wasm32-unknown-unknown target not installed',
      fix: 'rustup target add wasm32-unknown-unknown',
    }
  }

  // Check for wasm-pack.
  if (!(await commandExists('wasm-pack'))) {
    return {
      available: false,
      reason: 'wasm-pack not found',
      fix: 'cargo install wasm-pack',
    }
  }

  return { available: true, version: match[1] }
}

/**
 * Check Python version.
 */
export async function checkPython() {
  const pythonCmds = ['python3', 'python']
  const minVersion = getMinPythonVersion()
  const versionParts = minVersion.split('.').map(Number)
  const minMajor = versionParts[0] ?? 3
  const minMinor = versionParts[1] ?? 0

  for (const cmd of pythonCmds) {
    // eslint-disable-next-line no-await-in-loop
    if (await commandExists(cmd)) {
      // eslint-disable-next-line no-await-in-loop
      const version = await getCommandOutput(cmd, ['--version'])
      const match = version.match(/Python (\d+)\.(\d+)\.(\d+)/)

      if (match) {
        const major = Number.parseInt(match[1], 10)
        const minor = Number.parseInt(match[2], 10)
        const patch = Number.parseInt(match[3], 10)

        return {
          available: true,
          version: `${major}.${minor}.${patch}`,
          command: cmd,
          meetsRequirement:
            major > minMajor || (major === minMajor && minor >= minMinor),
        }
      }
    }
  }

  return { available: false }
}

/**
 * Setup build environment for current package.
 *
 * Activates necessary toolchains and verifies prerequisites.
 * Returns object with status and any error messages.
 *
 * @param {Object} options - Setup options
 * @param {boolean} options.emscripten - Require Emscripten SDK
 * @param {boolean} options.rust - Require Rust with WASM support
 * @param {boolean} options.python - Require Python (version from external-tools.json)
 * @param {boolean} options.autoSetup - Automatically run setup script if tools missing
 * @returns {Object} Setup result with status and messages
 */
export async function setupBuildEnvironment(options = {}) {
  const {
    autoSetup = true,
    emscripten = false,
    python = false,
    rust = false,
  } = options

  const results = {
    success: true,
    messages: [],
    errors: [],
  }

  // Check Emscripten.
  if (emscripten) {
    const activated = await activateEmscriptenSDK()

    if (activated) {
      const version = await getEmscriptenVersion()
      results.messages.push(`✓ Emscripten ${version} activated`)
    } else {
      results.success = false
      results.errors.push('✗ Emscripten SDK not found')

      if (autoSetup) {
        results.errors.push(
          '  Run: node scripts/setup-build-toolchain.mjs --emscripten',
        )
      } else {
        results.errors.push(
          '  Install from: https://emscripten.org/docs/getting_started/downloads.html',
        )
      }
    }
  }

  // Check Rust.
  if (rust) {
    const rustCheck = await checkRust()

    if (rustCheck.available) {
      results.messages.push(`✓ Rust ${rustCheck.version} with WASM support`)
    } else {
      results.success = false
      results.errors.push(`✗ Rust: ${rustCheck.reason}`)

      if (rustCheck.fix) {
        results.errors.push(`  Fix: ${rustCheck.fix}`)
      } else if (autoSetup) {
        results.errors.push(
          '  Run: node scripts/setup-build-toolchain.mjs --rust',
        )
      }
    }
  }

  // Check Python.
  if (python) {
    const pythonCheck = await checkPython()

    if (pythonCheck.available) {
      if (pythonCheck.meetsRequirement) {
        results.messages.push(`✓ Python ${pythonCheck.version}`)
      } else {
        results.success = false
        results.errors.push(
          `✗ Python ${pythonCheck.version} is too old (need ${getMinPythonVersion()}+)`,
        )

        if (autoSetup) {
          results.errors.push(
            '  Run: node scripts/setup-build-toolchain.mjs --python',
          )
        }
      }
    } else {
      results.success = false
      results.errors.push(`✗ Python ${getMinPythonVersion()}+ not found`)

      if (autoSetup) {
        results.errors.push(
          '  Run: node scripts/setup-build-toolchain.mjs --python',
        )
      }
    }
  }

  return results
}

/**
 * Print environment setup results.
 */
export function printSetupResults(results) {
  if (results.messages.length > 0) {
    logger.info('\nBuild Environment:')
    for (const message of results.messages) {
      logger.info(`  ${message}`)
    }
  }

  if (results.errors.length > 0) {
    logger.warn('\nMissing Prerequisites:')
    for (const error of results.errors) {
      logger.warn(`  ${error}`)
    }
  }

  if (!results.success) {
    logger.fail('Build environment setup failed')
    logger.info('   Run setup script to install missing tools\n')
  }
}
