/**
 * Loaders for external-tools.json — the pinned tool version registry.
 *
 * Sync and async variants for both package-local and monorepo-root lookups. All
 * loaders throw with What/Where/Fix context instead of defaulting to 'latest'.
 */

import { promises as fs, readFileSync } from 'node:fs'
import path from 'node:path'

import { errorMessage } from './error-utils.mts'

/**
 * Load and parse external-tools.json.
 *
 * @param {string} packageRoot - Absolute path to package root.
 *
 * @returns {Promise<object>} Parsed external-tools.json
 *
 * @throws {Error} If file doesn't exist or is malformed
 */
export async function loadExternalTools(packageRoot: string) {
  const externalToolsPath = path.join(packageRoot, 'external-tools.json')

  try {
    const content = await fs.readFile(externalToolsPath, 'utf8')
    return JSON.parse(content)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(
        `external-tools.json not found at: ${externalToolsPath}\n` +
          'Please ensure external-tools.json exists in the package root.',
        { cause: e },
      )
    }
    if (e instanceof SyntaxError) {
      throw new Error(
        `Malformed JSON in external-tools.json at: ${externalToolsPath}\n` +
          `Parse error: ${errorMessage(e)}`,
        { cause: e },
      )
    }
    throw e
  }
}

/**
 * Load and parse external-tools.json synchronously.
 *
 * @param {string} packageRoot - Absolute path to package root.
 *
 * @returns {object} Parsed external-tools.json
 *
 * @throws {Error} If file doesn't exist or is malformed
 */
export function loadExternalToolsSync(packageRoot: string) {
  const externalToolsPath = path.join(packageRoot, 'external-tools.json')

  try {
    const content = readFileSync(externalToolsPath, 'utf8')
    return JSON.parse(content)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(
        `external-tools.json not found at: ${externalToolsPath}\n` +
          'Please ensure external-tools.json exists in the package root.',
        { cause: e },
      )
    }
    if (e instanceof SyntaxError) {
      throw new Error(
        `Malformed JSON in external-tools.json at: ${externalToolsPath}\n` +
          `Parse error: ${errorMessage(e)}`,
        { cause: e },
      )
    }
    throw e
  }
}
