/**
 * Shared constants for Socket BTM build infrastructure
 *
 * Consolidated from: constants.mjs, environment-constants.mjs, paths.mjs, node-version.mjs
 */

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// =============================================================================
// Build Constants
// =============================================================================

/**
 * Byte conversion constants for consistent size calculations
 */
export const BYTES = {
  KB: 1024,
  MB: 1024 * 1024,
  GB: 1024 * 1024 * 1024,
}

/**
 * Build stage directory names used across packages.
 * Use these instead of hardcoded strings to ensure consistency.
 */
export const BUILD_STAGES = {
  RELEASE: 'Release',
  STRIPPED: 'Stripped',
  COMPRESSED: 'Compressed',
  FINAL: 'Final',
  OPTIMIZED: 'Optimized',
  SYNC: 'Sync',
}

/**
 * Maximum Node.js binary size that binject can process
 * Matches MAX_ELF_SIZE and MAX_PE_SIZE in binject C source (200 MB)
 *
 * This limit applies to the final Node.js binary (ELF or PE format) that
 * binject processes.
 */
export const MAX_NODE_BINARY_SIZE = 200 * BYTES.MB

/**
 * Maximum SEA (Single Executable Application) blob size
 * Matches Node.js's kMaxPayloadSize limit (2 GB - 1 byte)
 *
 * This is the maximum size for the application code embedded in the
 * NODE_SEA_BLOB section of a Node.js binary.
 */
export const MAX_SEA_BLOB_SIZE = 2_147_483_647

/**
 * Maximum VFS (Virtual File System) size
 * Matches MAX_RESOURCE_SIZE in binject C source (500 MB)
 *
 * This is the maximum size for the virtual file system data embedded in the
 * NODE_VFS_BLOB section.
 */
export const MAX_VFS_SIZE = 500 * BYTES.MB

// =============================================================================
// Environment Detection Constants
// =============================================================================

/**
 * Container detection files
 */
export const DOCKER_ENV_FILE = '/.dockerenv'
export const PODMAN_ENV_FILE = '/run/.containerenv'
export const ALPINE_RELEASE_FILE = '/etc/alpine-release'

/**
 * Linux proc filesystem paths
 */
export const PROC_CGROUP_FILE = '/proc/1/cgroup'
export const PROC_SELF_EXE = '/proc/self/exe'

/**
 * CI/Container workspace paths
 */
export const WORKSPACE_DIR = '/workspace'

/**
 * Homebrew path patterns
 */
export const HOMEBREW_CELLAR_EMSCRIPTEN_PATTERN = '/Cellar/emscripten/'

/**
 * Emscripten SDK search paths by platform
 */
export const EMSDK_SEARCH_PATHS = {
  darwin: [
    path.join(homedir(), '.emsdk'),
    path.join(homedir(), 'emsdk'),
    '/opt/emsdk',
    '/usr/local/emsdk',
  ],
  linux: [
    path.join(homedir(), '.emsdk'),
    path.join(homedir(), 'emsdk'),
    '/opt/emsdk',
    '/usr/local/emsdk',
  ],
  win32: [
    path.join(homedir(), '.emsdk'),
    path.join(homedir(), 'emsdk'),
    'C:\\emsdk',
  ],
}

/**
 * Compiler paths (Linux)
 */
export const COMPILER_PATHS = {
  linux: {
    gccVersioned: version => `/usr/bin/gcc-${version}`,
    gxxVersioned: version => `/usr/bin/g++-${version}`,
    gccDefault: '/usr/bin/gcc',
    gxxDefault: '/usr/bin/g++',
  },
}

// =============================================================================
// Path Constants
// =============================================================================

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/**
 * Package root directory (build-infra)
 */
export const PACKAGE_ROOT = path.resolve(__dirname, '..')

/**
 * Monorepo root directory
 */
export const MONOREPO_ROOT = path.resolve(PACKAGE_ROOT, '../..')

/**
 * Node.js version file at monorepo root
 */
export const NODE_VERSION_FILE = path.join(MONOREPO_ROOT, '.node-version')

// =============================================================================
// Node.js Version
// =============================================================================

/**
 * Raw Node.js version from .node-version file (e.g., "22.13.1")
 */
export const nodeVersionRaw = readFileSync(NODE_VERSION_FILE, 'utf-8').trim()

/**
 * Node.js version with 'v' prefix (e.g., "v22.13.1")
 */
export const NODE_VERSION = `v${nodeVersionRaw}`

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get the BUILD_MODE from environment variable.
 * Defaults to 'prod' in CI, 'dev' otherwise.
 * @returns {string} The build mode ('dev' or 'prod')
 */
export function getBuildMode() {
  if (process.env.BUILD_MODE) {
    return process.env.BUILD_MODE
  }
  return process.env.CI ? 'prod' : 'dev'
}

/**
 * Get binary output directory for a package.
 * Packages (binpress, binflate, binject) build to build/${BUILD_MODE}/out/Final/
 * @param {string} packageDir - The package directory path
 * @returns {string} The output directory path
 */
export function getBinOutDir(packageDir) {
  const buildMode = getBuildMode()
  return `${packageDir}/build/${buildMode}/out/${BUILD_STAGES.FINAL}`
}

/**
 * Get Emscripten SDK search paths for the current or specified platform.
 * @param {string} [platform] - Platform override (darwin, linux, win32)
 * @returns {string[]} Array of paths to search for EMSDK
 */
export function getEmsdkSearchPaths(platform = process.platform) {
  return EMSDK_SEARCH_PATHS[platform] || EMSDK_SEARCH_PATHS.linux
}

/**
 * Get GCC path for a specific version.
 * @param {number} version - GCC version number
 * @returns {string} Path to versioned GCC
 */
export function getGccPath(version) {
  return COMPILER_PATHS.linux.gccVersioned(version)
}

/**
 * Get G++ path for a specific version.
 * @param {number} version - G++ version number
 * @returns {string} Path to versioned G++
 */
export function getGxxPath(version) {
  return COMPILER_PATHS.linux.gxxVersioned(version)
}
