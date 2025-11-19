/**
 * Pinned dependency versions for reproducible builds.
 *
 * All external dependencies (Python packages, tools, etc.) should be pinned
 * to specific versions to ensure reproducible builds and prevent supply chain attacks.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * Load external tools configuration from package.json.
 * This is the single source of truth for all external tool dependencies.
 *
 * @param {string} [consumerPackageJsonPath] - Optional path to consumer package.json for overrides
 * @returns {object} External tools configuration
 */
function loadExternalTools(consumerPackageJsonPath) {
  // Load base configuration from build-infra
  let baseTools = {}
  try {
    const packageJsonPath = path.join(__dirname, '..', 'package.json')
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
    baseTools = packageJson.externalTools || {}
  } catch (e) {
    console.error(
      'Failed to load externalTools from build-infra package.json:',
      e?.message || 'Unknown error',
    )
  }

  // Load consumer overrides if provided
  if (consumerPackageJsonPath) {
    try {
      const consumerPackageJson = JSON.parse(
        readFileSync(consumerPackageJsonPath, 'utf8'),
      )
      const consumerTools = consumerPackageJson.externalTools || {}

      // Merge consumer overrides into base tools
      // Consumer Python package versions take precedence
      for (const [toolName, toolConfig] of Object.entries(consumerTools)) {
        if (toolConfig.type === 'python') {
          baseTools[toolName] = {
            ...baseTools[toolName],
            ...toolConfig,
            versions: {
              ...baseTools[toolName]?.versions,
              ...toolConfig.versions,
            },
          }
        }
      }
    } catch {
      // Consumer package.json not found or has no externalTools - use base only
    }
  }

  return baseTools
}

/**
 * Pinned tool versions and package names for package managers.
 *
 * Loaded from package.json externalTools field.
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
 * Loaded from package.json externalTools field (type: "python").
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
 * Loaded from package.json externalTools field (extras array).
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
 * @returns {string} Package specifier with pinned version (e.g., 'torch==2.5.0' or 'optimum[exporters]==1.23.3')
 */
export function getPinnedPackage(packageName) {
  const version = PYTHON_VERSIONS[packageName]
  if (!version) {
    throw new Error(
      `No pinned version found for ${packageName}. Add to externalTools in build-infra/package.json with type: "python"`,
    )
  }

  // Add extras if specified
  const extras = PYTHON_PACKAGE_EXTRAS[packageName]
  const packageSpec = extras
    ? `${packageName}[${extras.join(',')}]`
    : packageName

  return `${packageSpec}==${version}`
}

/**
 * Get multiple pinned package specifiers.
 *
 * @param {string[]} packageNames - Array of package names
 * @returns {string[]} Array of package specifiers with pinned versions
 */
export function getPinnedPackages(packageNames) {
  return packageNames.map(name => getPinnedPackage(name))
}

/**
 * Get tool configuration (description and packages).
 *
 * @param {string} toolName - Tool name
 * @returns {object|null} Tool configuration or null if not found
 */
export function getToolConfig(toolName) {
  return TOOL_VERSIONS[toolName] || null
}

/**
 * Get package specifier with version for tool installation.
 *
 * @param {string} toolName - Tool name
 * @param {string} packageName - Package name in the package manager
 * @param {string} packageManager - Package manager
 * @returns {string} Package specifier (e.g., 'cmake@3.31.4' for brew)
 */
export function getToolPackageSpec(toolName, packageName, packageManager) {
  const version = getToolVersion(toolName, packageManager)
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
 * @returns {string|null} Pinned version or null if not found
 */
export function getToolVersion(toolName, packageManager) {
  const tool = TOOL_VERSIONS[toolName]
  if (!tool || !tool.versions) {
    return null
  }
  return tool.versions[packageManager] || null
}

/**
 * Load Python versions with optional consumer package overrides.
 *
 * This allows individual packages to override Python package versions
 * by adding an externalTools section to their package.json.
 *
 * @param {string} [consumerPackageJsonPath] - Path to consumer package.json
 * @returns {{ PYTHON_VERSIONS: object, PYTHON_PACKAGE_EXTRAS: object }} Python configuration
 */
export function loadPythonVersions(consumerPackageJsonPath) {
  const tools = loadExternalTools(consumerPackageJsonPath)

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
