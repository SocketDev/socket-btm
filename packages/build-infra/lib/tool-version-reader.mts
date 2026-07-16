/**
 * Per-tool version readers — each reads one named tool's version from
 * external-tools.json or a pinned file (.node-version).
 *
 * Separate from the loaders so callers that only need one version string
 * don't drag in the full loader pair.
 */

import { readFileSync } from 'node:fs'

import { NODE_VERSION_FILE, PACKAGE_ROOT } from './constants.mts'
import {
  loadExternalTools,
  loadExternalToolsSync,
} from './external-tools-loader.mts'

/**
 * Load CMake version from external-tools.json.
 *
 * @example
 *   const version = await getCMakeVersion(PACKAGE_ROOT)
 *   // Returns: '3.28.1'
 *
 * @param {string} packageRoot - Absolute path to package root.
 *
 * @returns {Promise<string>} CMake version (e.g., '3.28.1')
 *
 * @throws {Error} If version not found or external-tools.json missing
 */
export async function getCMakeVersion(packageRoot: string): Promise<string> {
  const data = await loadExternalTools(packageRoot)

  const cmakeConfig = data.tools?.cmake
  if (!cmakeConfig) {
    throw new Error(
      `CMake config not found in external-tools.json at: ${packageRoot}\n` +
        `Expected: { "tools": { "cmake": { ... } } }`,
    )
  }

  const version = cmakeConfig.version
  if (!version) {
    throw new Error(
      `CMake version not found in external-tools.json at: ${packageRoot}\n` +
        `Expected: { "tools": { "cmake": { "version": "..." } } }`,
    )
  }

  return version
}

/**
 * Load Emscripten version from external-tools.json.
 *
 * @example
 *   const version = await getEmscriptenVersion(PACKAGE_ROOT)
 *   // Returns: '4.0.20'
 *
 * @param {string} packageRoot - Absolute path to package root.
 *
 * @returns {Promise<string>} Emscripten emsdk version (e.g., '4.0.20')
 *
 * @throws {Error} If version not found or external-tools.json missing
 */
export async function getEmscriptenVersion(
  packageRoot: string,
): Promise<string> {
  const data = await loadExternalTools(packageRoot)

  const emscriptenConfig = data.tools?.emscripten
  if (!emscriptenConfig) {
    throw new Error(
      `Emscripten config not found in external-tools.json at: ${packageRoot}\n` +
        `Expected: { "tools": { "emscripten": { ... } } }`,
    )
  }

  const version = emscriptenConfig.version
  if (!version) {
    throw new Error(
      `Emscripten version not found in external-tools.json at: ${packageRoot}\n` +
        `Expected: { "tools": { "emscripten": { "version": "..." } } }`,
    )
  }

  return version
}

let minPythonVersion: string | undefined
/**
 * Load minimum Python version from build-infra/external-tools.json.
 * Result is memoized for performance.
 *
 * @example
 *   const minVersion = getMinPythonVersion()
 *   // Returns: '3.6'
 *
 * @returns {string} Minimum Python version (e.g., '3.6')
 *
 * @throws {Error} If version not found or external-tools.json missing
 */
export function getMinPythonVersion(): string {
  if (minPythonVersion === undefined) {
    const data = loadExternalToolsSync(PACKAGE_ROOT)

    const pythonConfig = data.tools?.python
    if (!pythonConfig) {
      throw new Error(
        `Python config not found in external-tools.json at: ${PACKAGE_ROOT}\n` +
          `Expected: { "tools": { "python": { ... } } }`,
      )
    }

    const version = pythonConfig.version
    if (!version) {
      throw new Error(
        `Python version not found in external-tools.json at: ${PACKAGE_ROOT}\n` +
          `Expected: { "tools": { "python": { "version": "..." } } }`,
      )
    }

    minPythonVersion = version
  }
  return minPythonVersion as string
}

let nodeVersion: string | undefined
/**
 * Load Node.js version from .node-version file at monorepo root.
 * Result is memoized for performance.
 *
 * @example
 *   const version = getNodeVersion()
 *   // Returns: '24.12.0'
 *
 * @returns {string} Node.js version (e.g., '24.12.0')
 *
 * @throws {Error} If .node-version file not found or empty
 */
export function getNodeVersion(): string {
  if (nodeVersion === undefined) {
    try {
      const content = readFileSync(NODE_VERSION_FILE, 'utf8')
      const version = content.trim()

      if (!version) {
        throw new Error(`.node-version file is empty at: ${NODE_VERSION_FILE}`)
      }

      nodeVersion = version
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(
          `.node-version file not found at: ${NODE_VERSION_FILE}\n` +
            'Please ensure .node-version exists in the monorepo root.',
          { cause: e },
        )
      }
      throw e
    }
  }
  return nodeVersion
}

/**
 * Generic tool version loader from external-tools.json.
 *
 * @example
 *   const version = await getToolVersion(PACKAGE_ROOT, 'emscripten')
 *   // Returns: '4.0.20'
 *
 * @param {string} packageRoot - Absolute path to package root.
 * @param {string} toolName - Tool name (e.g., 'emscripten', 'cmake', 'python')
 *
 * @returns {Promise<string>} Tool version
 *
 * @throws {Error} If version not found or external-tools.json missing
 */
export async function getToolVersion(
  packageRoot: string,
  toolName: string,
): Promise<string> {
  const data = await loadExternalTools(packageRoot)

  const toolConfig = data.tools?.[toolName]
  if (!toolConfig) {
    throw new Error(
      `Tool '${toolName}' config not found in external-tools.json at: ${packageRoot}\n` +
        `Expected: { "tools": { "${toolName}": { ... } } }\n` +
        `Available tools: ${Object.keys(data.tools || {}).join(', ')}`,
    )
  }

  const version = toolConfig.version
  if (!version) {
    throw new Error(
      `Version not found for tool '${toolName}' in external-tools.json at: ${packageRoot}\n` +
        `Expected: { "tools": { "${toolName}": { "version": "..." } } }`,
    )
  }

  return version
}
