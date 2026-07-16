/**
 * Toolchain detection helpers — command existence, output capture, platform,
 * Docker detection, Python, Rust, and build-source flags.
 *
 * These are the foundational utilities that the emscripten and orchestration
 * modules build on.
 */

import { existsSync } from 'node:fs'
import os from 'node:os'
import process from 'node:process'

import { envAsBoolean } from '@socketsecurity/lib-stable/env/boolean'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { DOCKER_ENV_FILE, PODMAN_ENV_FILE } from './constants.mts'
import { getMinPythonVersion } from './version-helpers.mts'

/**
 * Throw an error if download is blocked by BUILD_*_FROM_SOURCE flags. Use this
 * at the start of download functions to enforce build-from-source policy.
 *
 * @param {string} toolName - Name of the tool being downloaded.
 * @param {'TOOLS' | 'DEPS'} flagType - The type of build flag to check.
 * @param {object} options - Options for customizing the error message.
 * @param {string} [options.buildCommand] - Custom build command suggestion.
 *
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
 * Check Python version.
 */
export async function checkPython() {
  const pythonCmds = ['python3', 'python']
  const minVersion = getMinPythonVersion()
  const versionParts = minVersion.split('.').map(Number)
  const minMajor = versionParts[0] ?? 3
  const minMinor = versionParts[1] ?? 0

  for (let i = 0, { length } = pythonCmds; i < length; i += 1) {
    const cmd = pythonCmds[i]
    // eslint-disable-next-line no-await-in-loop
    if (await commandExists(cmd)) {
      // eslint-disable-next-line no-await-in-loop
      const version = await getCommandOutput(cmd, ['--version'])
      // Python: literal; (\d+)\.(\d+)\.(\d+): major.minor.patch capture groups
      const match = version.match(/Python (\d+)\.(\d+)\.(\d+)/)

      if (match) {
        const major = Number.parseInt(match[1], 10)
        const minor = Number.parseInt(match[2], 10)
        const patch = Number.parseInt(match[3], 10)

        return {
          available: true,
          command: cmd,
          meetsRequirement:
            major > minMajor || (major === minMajor && minor >= minMinor),
          version: `${major}.${minor}.${patch}`,
        }
      }
    }
  }

  return { available: false }
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

  const targets = await getCommandOutput('rustup', [
    'target',
    'list',
    '--installed',
  ])
  if (!targets.includes('wasm32-unknown-unknown')) {
    return {
      available: false,
      fix: 'rustup target add wasm32-unknown-unknown',
      reason: 'wasm32-unknown-unknown target not installed',
    }
  }

  if (!(await commandExists('wasm-pack'))) {
    return {
      available: false,
      fix: 'cargo install wasm-pack',
      reason: 'wasm-pack not found',
    }
  }

  return { available: true, version: match[1] }
}

/**
 * Check if command exists.
 *
 * @param {string} cmd - Command name to look up in PATH.
 *
 * @returns {Promise<boolean>} True when the command resolves via
 *   `which`/`where`.
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
 * Get all build source flags as an object.
 *
 * @returns {{
 *   buildAllFromSource: boolean
 *   buildToolsFromSource: boolean
 *   buildDepsFromSource: boolean
 * }}
 */
export function getBuildSourceFlags() {
  const buildAllFromSource = envAsBoolean(process.env['BUILD_ALL_FROM_SOURCE'])
  return {
    buildAllFromSource,
    buildDepsFromSource:
      buildAllFromSource || envAsBoolean(process.env['BUILD_DEPS_FROM_SOURCE']),
    buildToolsFromSource:
      buildAllFromSource ||
      envAsBoolean(process.env['BUILD_TOOLS_FROM_SOURCE']),
  }
}

/**
 * Get command output.
 *
 * @param {string} cmd - Command to run.
 * @param {string[]} [args] - Command arguments.
 *
 * @returns {Promise<string>} Trimmed stdout, or empty string if the spawn
 *   failed.
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
 * Get platform identifier.
 *
 * @returns {NodeJS.Platform}
 */
export function getPlatform() {
  return os.platform()
}

/**
 * Detect if running in Docker.
 */
export function isDocker() {
  return existsSync(DOCKER_ENV_FILE) || existsSync(PODMAN_ENV_FILE)
}

/**
 * Check if building from source is required for a given flag type.
 *
 * @param {'TOOLS' | 'DEPS' | 'ALL'} flagType - The type of build flag to check.
 *
 * @returns {boolean} True if building from source is required.
 */
export function shouldBuildFromSource(flagType) {
  const buildAllFromSource = envAsBoolean(process.env['BUILD_ALL_FROM_SOURCE'])
  if (buildAllFromSource) {
    return true
  }
  if (flagType === 'ALL') {
    return false
  }
  return envAsBoolean(process.env[`BUILD_${flagType}_FROM_SOURCE`])
}
