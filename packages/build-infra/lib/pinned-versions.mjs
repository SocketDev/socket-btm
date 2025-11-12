/**
 * Pinned dependency versions for reproducible builds.
 *
 * All external dependencies (Python packages, tools, etc.) should be pinned
 * to specific versions to ensure reproducible builds and prevent supply chain attacks.
 */

/**
 * Pinned Python package versions.
 * Format: { packageName: 'version' }
 */
export const PYTHON_VERSIONS = {
  transformers: '4.48.0',
  torch: '2.6.0',
  onnx: '1.17.0',
  onnxruntime: '1.20.1',
  onnxscript: '0.5.6',
  huggingface_hub: '0.27.0',
  optimum: '1.23.3',
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
 * Pinned tool versions for package managers.
 * Format: { toolName: { packageManager: 'version' } }
 * Use '@latest' to always get the latest version (not recommended for production).
 */
export const TOOL_VERSIONS = {
  cmake: {
    brew: '3.31.4',
    apt: '3.22.1',
    choco: '3.31.4',
  },
  ninja: {
    brew: '1.12.1',
    apt: '1.11.1',
    choco: '1.12.1',
  },
  python3: {
    brew: '3.13.1',
    apt: '3.10.12', // Ubuntu 22.04 default
    choco: '3.13.1',
  },
  binaryen: {
    brew: '120',
    apt: '105', // Ubuntu 22.04 repo version
    choco: '120',
  },
}

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
  if (!tool) {
    return null
  }
  return tool[packageManager] || null
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
    return packageName // No version pinned, return bare package name
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
