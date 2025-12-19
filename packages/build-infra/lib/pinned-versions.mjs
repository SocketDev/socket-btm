/**
 * Pinned dependency versions for reproducible builds.
 *
 * All external dependencies (Python packages, tools, etc.) should be pinned
 * to specific versions to ensure reproducible builds and prevent supply chain attacks.
 *
 * Tool configurations are now loaded from external-tools.json files in a hierarchical structure:
 * 1. build-infra/external-tools.json (core fundamentals: git, curl, patch, make)
 * 2. <package>/external-tools.json (package-level tools)
 * 3. <package>/scripts/<checkpoint>/shared/external-tools.json (checkpoint-specific tools)
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * Load external tools from an external-tools.json file with extends support.
 *
 * @param {string} jsonPath - Path to external-tools.json
 * @param {Set<string>} [visited] - Set of visited paths to prevent circular dependencies
 * @returns {object} Tools configuration
 */
function loadExternalToolsJson(jsonPath, visited = new Set()) {
  try {
    if (!existsSync(jsonPath)) {
      return {}
    }

    // Prevent circular dependencies
    const resolvedPath = path.resolve(jsonPath)
    if (visited.has(resolvedPath)) {
      console.warn(`Circular dependency detected: ${resolvedPath}`)
      return {}
    }
    visited.add(resolvedPath)

    const data = JSON.parse(readFileSync(jsonPath, 'utf8'))
    let tools = {}

    // Handle extends field
    if (data.extends) {
      const extendsPath = path.resolve(path.dirname(jsonPath), data.extends)
      const extendedTools = loadExternalToolsJson(extendsPath, visited)
      tools = { ...extendedTools }
    }

    // Merge with current file's tools
    if (data.tools) {
      tools = { ...tools, ...data.tools }
    }

    return tools
  } catch (e) {
    console.error(
      `Failed to load external-tools.json from ${jsonPath}:`,
      e?.message || 'Unknown error',
    )
    return {}
  }
}

/**
 * Load external tools configuration with hierarchical merging.
 *
 * Precedence (highest to lowest):
 * 1. Checkpoint-specific: <package>/scripts/<checkpoint>/shared/external-tools.json
 * 2. Package-level: <package>/external-tools.json
 * 3. Core fundamentals: build-infra/external-tools.json
 *
 * @param {object} options - Loading options
 * @param {string} [options.packageRoot] - Package root directory (e.g., packages/node-smol-builder)
 * @param {string} [options.checkpointName] - Checkpoint name (e.g., 'binary-released')
 * @returns {object} Merged external tools configuration
 */
function loadExternalTools({ checkpointName, packageRoot } = {}) {
  let tools = {}

  // 1. Load core fundamentals from build-infra
  const buildInfraPath = path.join(__dirname, '..', 'external-tools.json')
  const coreTools = loadExternalToolsJson(buildInfraPath)
  tools = { ...tools, ...coreTools }

  // 2. Load package-level tools if packageRoot provided
  if (packageRoot) {
    const packageToolsPath = path.join(packageRoot, 'external-tools.json')
    const packageTools = loadExternalToolsJson(packageToolsPath)
    tools = { ...tools, ...packageTools }

    // 3. Load checkpoint-specific tools if checkpointName provided
    if (checkpointName) {
      const checkpointToolsPath = path.join(
        packageRoot,
        'scripts',
        checkpointName,
        'shared',
        'external-tools.json',
      )
      const checkpointTools = loadExternalToolsJson(checkpointToolsPath)
      tools = { ...tools, ...checkpointTools }
    }
  }

  return tools
}

/**
 * Pinned tool versions and package names for package managers.
 *
 * Loaded from external-tools.json files in hierarchical structure.
 * This is the single source of truth for all external dependencies.
 *
 * Format:
 * {
 *   toolName: {
 *     description: 'Human-readable description',
 *     type: 'python' | undefined,  // 'python' for Python packages
 *     packages: {
 *       darwin: { brew: 'package-name' },
 *       linux: { apt: 'package-name', ... },
 *       win32: { choco: 'package-name', ... }
 *     },
 *     versions: {
 *       brew: 'version',
 *       apt: 'version',
 *       pip: 'version',  // for Python packages
 *       ...
 *     },
 *     extras: ['extra1', 'extra2']  // for Python package extras
 *   }
 * }
 */
export const TOOL_VERSIONS = loadExternalTools()

/**
 * Pinned Python package versions.
 * Loaded from external-tools.json files (type: "python").
 *
 * Version compatibility matrix (tested working combination):
 * - PyTorch 2.5.1 + transformers 4.46.3 + optimum 1.23.3 (stable ONNX export)
 * - ONNX 1.17.0 + ONNXRuntime 1.21.0 (latest stable)
 * - HuggingFace Hub 0.26.5 + Sentence Transformers 3.3.1
 *
 * Format: { packageName: 'version' }
 */
export const PYTHON_VERSIONS = (() => {
  const versions = {}
  for (const [name, config] of Object.entries(TOOL_VERSIONS)) {
    if (config.type === 'python' && config.versions?.pip) {
      versions[name] = config.versions.pip
    }
  }
  return versions
})()

/**
 * Python package extras (optional dependencies).
 * Loaded from external-tools.json files (extras array).
 *
 * Format: { packageName: ['extra1', 'extra2'] }
 */
export const PYTHON_PACKAGE_EXTRAS = (() => {
  const extras = {}
  for (const [name, config] of Object.entries(TOOL_VERSIONS)) {
    if (config.type === 'python' && config.extras && config.extras.length > 0) {
      extras[name] = config.extras
    }
  }
  return extras
})()

/**
 * Get pinned package specifier for pip install.
 *
 * @param {string} packageName - Package name
 * @param {object} [options] - Loading options for hierarchical lookup
 * @returns {string} Package specifier with pinned version (e.g., 'torch==2.5.0' or 'optimum[exporters]==1.23.3')
 */
export function getPinnedPackage(packageName, options) {
  const tools = options ? loadExternalTools(options) : TOOL_VERSIONS
  const config = tools[packageName]

  if (!config || config.type !== 'python' || !config.versions?.pip) {
    throw new Error(
      `No pinned version found for ${packageName}. Add to external-tools.json with type: "python"`,
    )
  }

  const version = config.versions.pip

  // Add extras if specified
  const extras = config.extras
  const packageSpec = extras
    ? `${packageName}[${extras.join(',')}]`
    : packageName

  return `${packageSpec}==${version}`
}

/**
 * Get multiple pinned package specifiers.
 *
 * @param {string[]} packageNames - Array of package names
 * @param {object} [options] - Loading options for hierarchical lookup
 * @returns {string[]} Array of package specifiers with pinned versions
 */
export function getPinnedPackages(packageNames, options) {
  return packageNames.map(name => getPinnedPackage(name, options))
}

/**
 * Get tool configuration (description and packages).
 *
 * @param {string} toolName - Tool name
 * @param {object} [options] - Loading options for hierarchical lookup
 * @returns {object|null} Tool configuration or null if not found
 */
export function getToolConfig(toolName, options) {
  const tools = options ? loadExternalTools(options) : TOOL_VERSIONS
  return tools[toolName] || null
}

/**
 * Get package specifier with version for tool installation.
 *
 * @param {string} toolName - Tool name
 * @param {string} packageName - Package name in the package manager
 * @param {string} packageManager - Package manager
 * @param {object} [options] - Loading options for hierarchical lookup
 * @returns {string} Package specifier (e.g., 'cmake@3.31.4' for brew)
 */
export function getToolPackageSpec(
  toolName,
  packageName,
  packageManager,
  options,
) {
  const version = getToolVersion(toolName, packageManager, options)
  if (!version) {
    // No version pinned, return bare package name
    return packageName
  }

  // Format version specifier based on package manager
  switch (packageManager) {
    case 'apk':
    case 'apt':
    case 'dnf':
    case 'yum':
      return `${packageName}=${version}*`
    case 'brew':
      return `${packageName}@${version}`
    case 'choco':
      return `${packageName} --version ${version}`
    default:
      return packageName
  }
}

/**
 * Get pinned tool version for a package manager.
 *
 * @param {string} toolName - Tool name (e.g., 'cmake', 'ninja')
 * @param {string} packageManager - Package manager (e.g., 'brew', 'apt', 'choco')
 * @param {object} [options] - Loading options for hierarchical lookup
 * @returns {string|null} Pinned version or null if not found
 */
export function getToolVersion(toolName, packageManager, options) {
  const tools = options ? loadExternalTools(options) : TOOL_VERSIONS
  const tool = tools[toolName]
  if (!tool || !tool.versions) {
    return null
  }
  return tool.versions[packageManager] || null
}

/**
 * Load Python versions with optional package/checkpoint context.
 *
 * This allows checkpoints to have their own Python package versions
 * by creating checkpoint-specific external-tools.json files.
 *
 * @param {object} [options] - Loading options
 * @param {string} [options.packageRoot] - Package root directory
 * @param {string} [options.checkpointName] - Checkpoint name
 * @returns {{ PYTHON_VERSIONS: object, PYTHON_PACKAGE_EXTRAS: object }} Python configuration
 */
export function loadPythonVersions(options) {
  const tools = loadExternalTools(options || {})

  const versions = {}
  const extras = {}

  for (const [name, config] of Object.entries(tools)) {
    if (config.type === 'python' && config.versions?.pip) {
      versions[name] = config.versions.pip

      if (config.extras && config.extras.length > 0) {
        extras[name] = config.extras
      }
    }
  }

  return {
    PYTHON_VERSIONS: versions,
    PYTHON_PACKAGE_EXTRAS: extras,
  }
}

/**
 * Load all tools with package/checkpoint context.
 *
 * @param {object} [options] - Loading options
 * @param {string} [options.packageRoot] - Package root directory
 * @param {string} [options.checkpointName] - Checkpoint name
 * @returns {object} All tools configuration
 */
export function loadAllTools(options) {
  return loadExternalTools(options || {})
}
