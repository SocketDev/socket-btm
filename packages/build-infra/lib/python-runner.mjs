/**
 * Python script execution utilities.
 *
 * Provides standardized methods for invoking Python scripts with:
 * - Automatic python3 resolution
 * - JSON output parsing
 * - Error handling
 * - Logging integration
 */

import { which } from '@socketsecurity/lib/bin'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

import { getMinPythonVersion } from './version-helpers.mjs'

const logger = getDefaultLogger()

/**
 * Get the python3 executable path.
 *
 * @returns {Promise<string>} Path to python3
 * @throws {Error} If python3 is not found
 */
async function getPython3Path() {
  const python3Path = await which('python3', { nothrow: true })
  if (!python3Path) {
    throw new Error(
      `python3 not found in PATH. Please install Python ${getMinPythonVersion()} or later.`,
    )
  }
  return python3Path
}

/**
 * Run Python code inline (via -c flag).
 *
 * @param {string} code - Python code to execute
 * @param {object} [options] - Spawn options
 * @param {boolean} [options.silent=false] - Suppress logging
 * @returns {Promise<{code: number, stdout: string, stderr: string}>}
 */
export async function runPythonInline(code, options = {}) {
  const python3Path = await getPython3Path()
  const { silent = false, ...spawnOptions } = options

  if (!silent) {
    logger.substep('Running Python code...')
  }

  return await spawn(python3Path, ['-c', code], spawnOptions)
}

/**
 * Run a Python script file.
 *
 * @param {string} scriptPath - Path to Python script
 * @param {string[]} [args=[]] - Script arguments
 * @param {object} [options] - Spawn options
 * @param {boolean} [options.silent=false] - Suppress logging
 * @returns {Promise<{code: number, stdout: string, stderr: string}>}
 */
export async function runPythonScript(scriptPath, args = [], options = {}) {
  const python3Path = await getPython3Path()
  const { silent = false, ...spawnOptions } = options

  if (!silent) {
    logger.substep(`Running Python script: ${scriptPath}`)
  }

  return await spawn(python3Path, [scriptPath, ...args], spawnOptions)
}

/**
 * Run a Python script and parse JSON output.
 *
 * @param {string} scriptPath - Path to Python script
 * @param {string[]} [args=[]] - Script arguments
 * @param {object} [options] - Spawn options
 * @param {boolean} [options.silent=false] - Suppress logging
 * @returns {Promise<any>} Parsed JSON output
 * @throws {Error} If script fails or output is not valid JSON
 */
export async function runPythonScriptWithJson(
  scriptPath,
  args = [],
  options = {},
) {
  const { silent = false, ...spawnOptions } = options

  const result = await runPythonScript(scriptPath, args, {
    ...spawnOptions,
    silent,
  })

  if (result.code !== 0) {
    throw new Error(
      `Python script failed with exit code ${result.code}: ${result.stderr}`,
    )
  }

  try {
    return JSON.parse(result.stdout)
  } catch (error) {
    throw new Error(
      `Failed to parse Python script JSON output: ${error.message}\nOutput: ${result.stdout}`,
    )
  }
}

/**
 * Run a Python module (via -m flag).
 *
 * @param {string} moduleName - Python module name
 * @param {string[]} [args=[]] - Module arguments
 * @param {object} [options] - Spawn options
 * @param {boolean} [options.silent=false] - Suppress logging
 * @returns {Promise<{code: number, stdout: string, stderr: string}>}
 */
export async function runPythonModule(moduleName, args = [], options = {}) {
  const python3Path = await getPython3Path()
  const { silent = false, ...spawnOptions } = options

  if (!silent) {
    logger.substep(`Running Python module: ${moduleName}`)
  }

  return await spawn(python3Path, ['-m', moduleName, ...args], spawnOptions)
}
