/**
 * Shared helpers for loading tool versions from external-tools.json
 *
 * This ensures consistent version loading across all packages.
 * All functions throw descriptive errors instead of defaulting to 'latest'
 * to ensure explicit version management.
 */

import { promises as fs, readFileSync } from 'node:fs'
import path from 'node:path'

import { NODE_VERSION_FILE, PACKAGE_ROOT } from './constants.mjs'

/**
 * Load and parse external-tools.json synchronously
 *
 * @param {string} packageRoot - Absolute path to package root
 * @returns {object} Parsed external-tools.json
 * @throws {Error} If file doesn't exist or is malformed
 */
function loadExternalToolsSync(packageRoot) {
  const externalToolsPath = path.join(packageRoot, 'external-tools.json')

  try {
    const content = readFileSync(externalToolsPath, 'utf-8')
    return JSON.parse(content)
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(
        `external-tools.json not found at: ${externalToolsPath}\n` +
          'Please ensure external-tools.json exists in the package root.',
      )
    }
    if (error instanceof SyntaxError) {
      throw new Error(
        `Malformed JSON in external-tools.json at: ${externalToolsPath}\n` +
          `Parse error: ${error.message}`,
      )
    }
    throw error
  }
}

/**
 * Load and parse external-tools.json
 *
 * @param {string} packageRoot - Absolute path to package root
 * @returns {Promise<object>} Parsed external-tools.json
 * @throws {Error} If file doesn't exist or is malformed
 */
async function loadExternalTools(packageRoot) {
  const externalToolsPath = path.join(packageRoot, 'external-tools.json')

  try {
    const content = await fs.readFile(externalToolsPath, 'utf-8')
    return JSON.parse(content)
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(
        `external-tools.json not found at: ${externalToolsPath}\n` +
          'Please ensure external-tools.json exists in the package root.',
      )
    }
    if (error instanceof SyntaxError) {
      throw new Error(
        `Malformed JSON in external-tools.json at: ${externalToolsPath}\n` +
          `Parse error: ${error.message}`,
      )
    }
    throw error
  }
}

/**
 * Load Emscripten version from external-tools.json
 *
 * @param {string} packageRoot - Absolute path to package root
 * @returns {Promise<string>} Emscripten emsdk version (e.g., '4.0.20')
 * @throws {Error} If version not found or external-tools.json missing
 * @example
 * const version = await getEmscriptenVersion(PACKAGE_ROOT)
 * // Returns: '4.0.20'
 */
export async function getEmscriptenVersion(packageRoot) {
  const data = await loadExternalTools(packageRoot)

  const emscriptenConfig = data.tools?.emscripten
  if (!emscriptenConfig) {
    throw new Error(
      `Emscripten config not found in external-tools.json at: ${packageRoot}\n` +
        `Expected: { "tools": { "emscripten": { ... } } }`,
    )
  }

  const version = emscriptenConfig.versions?.emsdk
  if (!version) {
    throw new Error(
      `Emscripten emsdk version not found in external-tools.json at: ${packageRoot}\n` +
        `Expected: { "tools": { "emscripten": { "versions": { "emsdk": "..." } } } }`,
    )
  }

  return version
}

let _nodeVersion
/**
 * Load Node.js version from .node-version file at monorepo root.
 * Result is memoized for performance.
 *
 * @returns {string} Node.js version (e.g., '24.12.0')
 * @throws {Error} If .node-version file not found or empty
 * @example
 * const version = getNodeVersion()
 * // Returns: '24.12.0'
 */
export function getNodeVersion() {
  if (_nodeVersion === undefined) {
    try {
      const content = readFileSync(NODE_VERSION_FILE, 'utf-8')
      const version = content.trim()

      if (!version) {
        throw new Error(`.node-version file is empty at: ${NODE_VERSION_FILE}`)
      }

      _nodeVersion = version
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new Error(
          `.node-version file not found at: ${NODE_VERSION_FILE}\n` +
            'Please ensure .node-version exists in the monorepo root.',
        )
      }
      throw error
    }
  }
  return _nodeVersion
}

let _minPythonVersion
/**
 * Load minimum Python version from build-infra/external-tools.json.
 * Result is memoized for performance.
 *
 * @returns {string} Minimum Python version (e.g., '3.6')
 * @throws {Error} If version not found or external-tools.json missing
 * @example
 * const minVersion = getMinPythonVersion()
 * // Returns: '3.6'
 */
export function getMinPythonVersion() {
  if (_minPythonVersion === undefined) {
    const data = loadExternalToolsSync(PACKAGE_ROOT)

    const pythonConfig = data.tools?.python
    if (!pythonConfig) {
      throw new Error(
        `Python config not found in external-tools.json at: ${PACKAGE_ROOT}\n` +
          `Expected: { "tools": { "python": { ... } } }`,
      )
    }

    const version = pythonConfig.versions?.minimumVersion
    if (!version) {
      throw new Error(
        `Python minimumVersion not found in external-tools.json at: ${PACKAGE_ROOT}\n` +
          `Expected: { "tools": { "python": { "versions": { "minimumVersion": "..." } } } }`,
      )
    }

    _minPythonVersion = version
  }
  return _minPythonVersion
}

/**
 * Load CMake version from external-tools.json
 *
 * @param {string} packageRoot - Absolute path to package root
 * @returns {Promise<string>} CMake version (e.g., '3.28.1')
 * @throws {Error} If version not found or external-tools.json missing
 * @example
 * const version = await getCMakeVersion(PACKAGE_ROOT)
 * // Returns: '3.28.1'
 */
export async function getCMakeVersion(packageRoot) {
  const data = await loadExternalTools(packageRoot)

  const cmakeConfig = data.tools?.cmake
  if (!cmakeConfig) {
    throw new Error(
      `CMake config not found in external-tools.json at: ${packageRoot}\n` +
        `Expected: { "tools": { "cmake": { ... } } }`,
    )
  }

  const version = cmakeConfig.versions?.cmake
  if (!version) {
    throw new Error(
      `CMake version not found in external-tools.json at: ${packageRoot}\n` +
        `Expected: { "tools": { "cmake": { "versions": { "cmake": "..." } } } }`,
    )
  }

  return version
}

/**
 * Generic tool version loader from external-tools.json
 *
 * @param {string} packageRoot - Absolute path to package root
 * @param {string} toolName - Tool name (e.g., 'emscripten', 'cmake', 'python')
 * @param {string} versionKey - Version key within tool config (e.g., 'emsdk', 'cmake', 'recommendedVersion')
 * @returns {Promise<string>} Tool version
 * @throws {Error} If version not found or external-tools.json missing
 * @example
 * const version = await getToolVersion(PACKAGE_ROOT, 'emscripten', 'emsdk')
 * // Returns: '4.0.20'
 */
export async function getToolVersion(packageRoot, toolName, versionKey) {
  const data = await loadExternalTools(packageRoot)

  const toolConfig = data.tools?.[toolName]
  if (!toolConfig) {
    throw new Error(
      `Tool '${toolName}' config not found in external-tools.json at: ${packageRoot}\n` +
        `Expected: { "tools": { "${toolName}": { ... } } }\n` +
        `Available tools: ${Object.keys(data.tools || {}).join(', ')}`,
    )
  }

  const version = toolConfig.versions?.[versionKey]
  if (!version) {
    throw new Error(
      `Version key '${versionKey}' not found for tool '${toolName}' in external-tools.json at: ${packageRoot}\n` +
        `Expected: { "tools": { "${toolName}": { "versions": { "${versionKey}": "..." } } } }\n` +
        `Available version keys: ${Object.keys(toolConfig.versions || {}).join(', ')}`,
    )
  }

  return version
}
