// max-file-lines: legitimate -- cohesive module — one tool/domain/phase; splitting along arbitrary line cap would fracture related logic
/**
 * Shared helpers for loading tool versions from external-tools.json.
 *
 * This ensures consistent version loading across all packages.
 * All functions throw descriptive errors instead of defaulting to 'latest'
 * to ensure explicit version management.
 */

import { promises as fs, readFileSync } from 'node:fs'
import path from 'node:path'

import { fetchChecksumFile } from '@socketsecurity/lib-stable/http-request/checksum-file'

import { NODE_VERSION_FILE, PACKAGE_ROOT } from './constants.mts'
import { errorMessage } from './error-utils.mts'

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

/**
 * Load and parse external-tools.json.
 *
 * @param {string} packageRoot - Absolute path to package root.
 *
 * @returns {Promise<object>} Parsed external-tools.json
 *
 * @throws {Error} If file doesn't exist or is malformed
 */
// oxlint-disable-next-line socket/sort-source-methods -- helpers are co-located with their loader and consumer triplets; autofix bails on the const-table interleaving and alphabetizing would scatter related helpers.
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
// oxlint-disable-next-line socket/sort-source-methods -- helpers are co-located with their loader and consumer triplets; autofix bails on the const-table interleaving and alphabetizing would scatter related helpers.
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
// oxlint-disable-next-line socket/sort-source-methods -- helpers are co-located with their loader and consumer triplets; autofix bails on the const-table interleaving and alphabetizing would scatter related helpers.
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
// oxlint-disable-next-line socket/sort-source-methods -- helpers are co-located with their loader and consumer triplets; autofix bails on the const-table interleaving and alphabetizing would scatter related helpers.
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
// oxlint-disable-next-line socket/sort-source-methods -- helpers are co-located with their loader and consumer triplets; autofix bails on the const-table interleaving and alphabetizing would scatter related helpers.
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
// oxlint-disable-next-line socket/sort-source-methods -- helpers are co-located with their loader and consumer triplets; autofix bails on the const-table interleaving and alphabetizing would scatter related helpers.
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

/**
 * Extract submodule version from .gitmodules version comment.
 *
 * Parses version comments in the format `# package-X.Y.Z` above submodule
 * entries. Expects consistent format: `# <package>-<version>` (version may be
 * semver or other formats)
 *
 * @example
 *   const version = getSubmoduleVersion(
 *     'packages/lief-builder/upstream/lief',
 *     'lief',
 *   )
 *   // Returns: '0.17.0'
 *
 * @param {string} submodulePath - Submodule path (e.g.,
 *   "packages/lief-builder/upstream/lief")
 * @param {string} packageName - Package name (e.g., "lief")
 *
 * @returns {string} Version string (e.g., "0.17.0")
 *
 * @throws {Error} If version comment not found or malformed
 */
// oxlint-disable-next-line socket/sort-source-methods -- helpers are co-located with their loader and consumer triplets; autofix bails on the const-table interleaving and alphabetizing would scatter related helpers.
export function getSubmoduleVersion(
  submodulePath: string,
  packageName: string,
): string {
  // Validate inputs
  if (!packageName || packageName.trim() === '') {
    throw new Error('Package name cannot be empty')
  }

  // Find .gitmodules at monorepo root (3 levels up from build-infra/lib/)
  const gitmodulesPath = path.join(PACKAGE_ROOT, '..', '..', '.gitmodules')

  let content
  try {
    content = readFileSync(gitmodulesPath, 'utf8')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(
        `.gitmodules not found at: ${gitmodulesPath}\n` +
          'This function must be called from within a monorepo package.',
        { cause: e },
      )
    }
    throw e
  }

  // Escape package name to prevent regex injection
  const escapedPackageName = packageName.replace(
    /[.*+?^${}()|[\]\\]/g,
    String.raw`\$&`,
  )

  // Escape submodule path for regex (only brackets need escaping in RegExp constructor)
  const escapedPath = submodulePath
    .replace(/\[/g, String.raw`\[`)
    .replace(/\]/g, String.raw`\]`)

  // Match version comment that appears BEFORE the submodule section.
  // Format: # package-VERSION [optional checksum]\n[submodule "path"]
  // Captures version (up to whitespace/newline) and optional trailing content
  const versionPattern = `# ${escapedPackageName}-(\\S+)[^\\n]*\\n\\[submodule "${escapedPath}"\\]`
  const versionRegex = new RegExp(versionPattern)
  const versionMatch = content.match(versionRegex)

  if (!versionMatch || !versionMatch[1]) {
    // Check if the submodule section exists at all.
    const sectionRegex = new RegExp(`\\[submodule "${escapedPath}"\\]`)
    const sectionExists = sectionRegex.test(content)

    if (!sectionExists) {
      throw new Error(
        `Submodule '${submodulePath}' not found in .gitmodules\n` +
          `Expected section: [submodule "${submodulePath}"]`,
      )
    }

    throw new Error(
      `Version comment not found for submodule '${submodulePath}' in .gitmodules\n` +
        `Expected format: # ${packageName}-X.Y.Z immediately before [submodule "${submodulePath}"]\n` +
        `Example:\n# ${packageName}-1.0.0\n[submodule "${submodulePath}"]`,
    )
  }

  return versionMatch[1]
}

/**
 * Extract submodule checksum from .gitmodules version comment.
 *
 * Parses checksum annotations in the format `# package-X.Y.Z sha256:<hex>`
 * above submodule entries. Returns undefined if no checksum is present
 * (checksum is optional).
 *
 * @example
 *   const checksum = getSubmoduleChecksum(
 *     'packages/node-smol-builder/upstream/node',
 *     'node',
 *   )
 *   // Returns: { algorithm: 'sha256', hash: '10335f268f...' }
 *
 * @param {string} submodulePath - Submodule path (e.g.,
 *   "packages/node-smol-builder/upstream/node")
 * @param {string} packageName - Package name (e.g., "node")
 *
 * @returns {{ algorithm: string; hash: string } | undefined} Checksum object or
 *   undefined.
 */
// oxlint-disable-next-line socket/sort-source-methods -- helpers are co-located with their loader and consumer triplets; autofix bails on the const-table interleaving and alphabetizing would scatter related helpers.
export function getSubmoduleChecksum(
  submodulePath: string,
  packageName: string,
): { algorithm: string; hash: string } | undefined {
  if (!packageName || packageName.trim() === '') {
    throw new Error('Package name cannot be empty')
  }

  const gitmodulesPath = path.join(PACKAGE_ROOT, '..', '..', '.gitmodules')

  let content
  try {
    content = readFileSync(gitmodulesPath, 'utf8')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(
        `.gitmodules not found at: ${gitmodulesPath}\n` +
          'This function must be called from within a monorepo package.',
        { cause: e },
      )
    }
    throw e
  }

  const escapedPackageName = packageName.replace(
    /[.*+?^${}()|[\]\\]/g,
    String.raw`\$&`,
  )
  const escapedPath = submodulePath
    .replace(/\[/g, String.raw`\[`)
    .replace(/\]/g, String.raw`\]`)

  // Match: # package-VERSION algorithm:hash\n[submodule "path"]
  const checksumPattern = `# ${escapedPackageName}-\\S+\\s+(\\w+):([0-9a-f]+)\\n\\[submodule "${escapedPath}"\\]`
  const checksumRegex = new RegExp(checksumPattern)
  const checksumMatch = content.match(checksumRegex)

  if (!checksumMatch) {
    return undefined
  }

  return {
    __proto__: null,
    algorithm: checksumMatch[1]!,
    hash: checksumMatch[2]!,
  } as { algorithm: string; hash: string }
}

/**
 * Fetch the SHA-256 checksum for a Node.js source tarball from nodejs.org.
 *
 * Downloads SHASUMS256.txt from the official Node.js distribution and extracts
 * the checksum for `node-vX.Y.Z.tar.gz`. Used by the update-node skill to
 * store the checksum in .gitmodules during version updates.
 *
 * @example
 *   const result = await fetchNodeChecksum('1.2.3')
 *   if ('hash' in result) {
 *     // Write to .gitmodules: # node-1.2.3 sha256:<result.hash>
 *   }
 *
 * @param {string} version - Node.js version without 'v' prefix (e.g., '1.2.3')
 * @param {object} [options]
 * @param {number} [options.timeout=10_000] - Fetch timeout in milliseconds.
 *
 * @returns {Promise<
 *   { hash: string; version: string } | { error: string; version: string }
 * >}
 */
// oxlint-disable-next-line socket/sort-source-methods -- helpers are co-located with their loader and consumer triplets; autofix bails on the const-table interleaving and alphabetizing would scatter related helpers.
export async function fetchNodeChecksum(
  version: string,
  options?: { timeout?: number | undefined },
): Promise<
  { hash: string; version: string } | { error: string; version: string }
> {
  options = { __proto__: null, ...options } as typeof options
  const versionTag = `v${version}`
  const timeout = options?.timeout ?? 10_000
  const url = `https://nodejs.org/dist/${versionTag}/SHASUMS256.txt`
  const tarballName = `node-${versionTag}.tar.gz`

  let checksums
  try {
    // Force an uncompressed response. nodejs.org serves SHASUMS256.txt with
    // zstd content-encoding, which httpText/fetchChecksumFile does not decode —
    // the parser then sees binary garbage and returns zero entries, so the
    // real `node-vX.Y.Z.tar.gz` line is reported "not found". Requesting
    // `identity` makes the body plain text the GNU-style parser can read.
    checksums = await fetchChecksumFile(url, {
      headers: { 'accept-encoding': 'identity' },
      timeout,
    })
  } catch (e) {
    return {
      __proto__: null,
      version,
      error: `Failed to fetch ${url}: ${errorMessage(e)}`,
    } as unknown as { error: string; version: string }
  }

  const hash = checksums[tarballName]
  if (!hash) {
    return {
      __proto__: null,
      version,
      error: `${tarballName} not found in SHASUMS256.txt`,
    } as unknown as { error: string; version: string }
  }

  return { __proto__: null, hash, version } as unknown as {
    hash: string
    version: string
  }
}

/**
 * Verify Node.js submodule checksum against nodejs.org SHASUMS256.txt.
 *
 * Fetches the official checksum for the Node.js source tarball and compares
 * it against the checksum stored in .gitmodules. This ensures the submodule
 * points to an authentic Node.js release.
 *
 * @example
 *   const result = await verifyNodeChecksum()
 *   if (!result.valid)
 *     throw new Error(
 *       `Checksum mismatch: ${result.expected} !== ${result.actual}`,
 *     )
 *
 * @param {object} [options]
 * @param {string} [options.version] - Node.js version to verify (default: from
 *   .node-version)
 * @param {number} [options.timeout=10_000] - Fetch timeout in milliseconds.
 *
 * @returns {Promise<{
 *   valid: boolean
 *   expected?: string
 *   actual?: string
 *   version: string
 *   error?: string
 * }>}
 */
export async function verifyNodeChecksum(options?: {
  version?: string | undefined
  timeout?: number | undefined
}): Promise<{
  valid: boolean
  expected?: string | undefined
  actual?: string | undefined
  version: string
  error?: string | undefined
}> {
  options = { __proto__: null, ...options } as typeof options
  type VerifyResult = {
    valid: boolean
    expected?: string | undefined
    actual?: string | undefined
    version: string
    error?: string | undefined
  }
  const version = options?.version ?? getNodeVersion()

  const stored = getSubmoduleChecksum(
    'packages/node-smol-builder/upstream/node',
    'node',
  )

  if (!stored) {
    return {
      __proto__: null,
      valid: false,
      version,
      error: 'No checksum found in .gitmodules for node submodule',
    } as unknown as VerifyResult
  }

  const result = await fetchNodeChecksum(version, options)
  if ('error' in result) {
    return {
      __proto__: null,
      valid: false,
      version,
      error: result.error,
    } as unknown as VerifyResult
  }

  return {
    __proto__: null,
    valid: stored.hash === result.hash,
    expected: result.hash,
    actual: stored.hash,
    version,
  } as unknown as VerifyResult
}
