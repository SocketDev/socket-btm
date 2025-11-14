/**
 * Pinned dependency versions for reproducible builds.
 *
 * All external dependencies (Python packages, tools, etc.) should be pinned
 * to specific versions to ensure reproducible builds and prevent supply chain attacks.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

/**
 * Load external tools configuration from package.json.
 * This is the single source of truth for all external tool dependencies.
 */
function loadExternalTools() {
  try {
    const packageJsonPath = join(__dirname, '..', 'package.json')
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
    return packageJson.externalTools || {}
  } catch (error) {
    console.error(
      'Failed to load externalTools from package.json:',
      error.message,
    )
    return {}
  }
}

/**
 * Pinned Python package versions.
 * Format: { packageName: 'version' }
 */
export const PYTHON_VERSIONS = {
  transformers: '4.57.1',
  torch: '2.8.0',
  onnx: '1.19.1',
  onnxruntime: '1.19.2',
  onnxscript: '0.5.6',
  huggingface_hub: '0.27.0',
  optimum: '1.17.0',
  sentence_transformers: '3.3.1',
}

/**
 * Python package extras (optional dependencies).
 * Format: { packageName: ['extra1', 'extra2'] }
 */
export const PYTHON_PACKAGE_EXTRAS = {
  optimum: ['exporters'],
}

/**
 * Pinned tool versions and package names for package managers.
 *
 * Loaded from package.json externalTools field.
 * Format:
 * {
 *   toolName: {
 *     description: 'Human-readable description',
 *     packages: {
 *       darwin: { brew: 'package-name' },
 *       linux: { apt: 'package-name', ... },
 *       win32: { choco: 'package-name', ... }
 *     },
 *     versions: {
 *       brew: 'version',
 *       apt: 'version',
 *       ...
 *     }
 *   }
 * }
 */
export const TOOL_VERSIONS = loadExternalTools()

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
      `No pinned version found for ${packageName}. Add to PYTHON_VERSIONS in pinned-versions.mjs`,
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
    case 'brew':
      return `${packageName}@${version}`
    case 'apt':
    case 'yum':
    case 'dnf':
    case 'apk':
      return `${packageName}=${version}*`
    case 'choco':
      return `${packageName} --version ${version}`
    default:
      return packageName
  }
}
