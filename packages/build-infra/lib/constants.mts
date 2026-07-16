/**
 * Shared constants for Socket BTM build infrastructure.
 *
 * Consolidated from: constants.mts, environment-constants.mts, paths.mts,
 * node-version.mts.
 */

import { readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { fileURLToPath } from 'node:url'

import { getCI } from '@socketsecurity/lib-stable/env/ci'

// =============================================================================
// Path Constants
// =============================================================================

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// =============================================================================
// Build Constants
// =============================================================================

/**
 * Byte conversion constants for consistent size calculations.
 */
export const BYTES = {
  GB: 1024 * 1024 * 1024,
  KB: 1024,
  MB: 1024 * 1024,
}

/**
 * Build stage directory names used across packages.
 * Use these instead of hardcoded strings to ensure consistency.
 */
export const BUILD_STAGES = {
  COMPRESSED: 'Compressed',
  FINAL: 'Final',
  OPTIMIZED: 'Optimized',
  RELEASE: 'Release',
  STRIPPED: 'Stripped',
  SYNC: 'Sync',
}

// Checkpoint names, per-package checkpoint chains, and chain validation are
// split into ./checkpoint-phase-constants.mts (max-file-lines soft cap) — the
// module also self-validates every chain at load time. Re-exported here so
// existing `from './constants.mts'` imports keep working unchanged.
export {
  CHECKPOINT_CHAINS,
  CHECKPOINTS,
  PLATFORM_AGNOSTIC_CHECKPOINTS,
  validateCheckpointChain,
} from './checkpoint-phase-constants.mts'

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
 * Container detection files.
 */
export const DOCKER_ENV_FILE = '/.dockerenv'
export const PODMAN_ENV_FILE = '/run/.containerenv'
export const ALPINE_RELEASE_FILE = '/etc/alpine-release'

/**
 * Linux proc filesystem paths.
 */
export const PROC_CGROUP_FILE = '/proc/1/cgroup'
export const PROC_SELF_EXE = '/proc/self/exe'

/**
 * CI/Container workspace paths.
 */
export const WORKSPACE_DIR = '/workspace'

/**
 * Homebrew path patterns.
 */
export const HOMEBREW_CELLAR_EMSCRIPTEN_PATTERN = '/Cellar/emscripten/'

/**
 * Emscripten SDK search paths by platform.
 */
export const EMSDK_SEARCH_PATHS = {
  darwin: [
    path.join(os.homedir(), '.emsdk'),
    path.join(os.homedir(), 'emsdk'),
    '/opt/emsdk',
    '/usr/local/emsdk',
  ],
  linux: [
    path.join(os.homedir(), '.emsdk'),
    path.join(os.homedir(), 'emsdk'),
    '/opt/emsdk',
    '/usr/local/emsdk',
  ],
  win32: [
    path.join(os.homedir(), '.emsdk'),
    path.join(os.homedir(), 'emsdk'),
    String.raw`C:\emsdk`,
  ],
}

/**
 * Compiler paths (Linux)
 */
export const COMPILER_PATHS = {
  linux: {
    gccDefault: '/usr/bin/gcc',
    gccVersioned: (version: number) => `/usr/bin/gcc-${version}`,
    gxxDefault: '/usr/bin/g++',
    gxxVersioned: (version: number) => `/usr/bin/g++-${version}`,
  },
}

/**
 * Package root directory (build-infra)
 */
export const PACKAGE_ROOT = path.resolve(__dirname, '..')

/**
 * Monorepo root directory.
 */
export const MONOREPO_ROOT = path.resolve(PACKAGE_ROOT, '../..')

/**
 * Node.js version file at monorepo root.
 */
export const NODE_VERSION_FILE = path.join(MONOREPO_ROOT, '.node-version')

// =============================================================================
// Node.js Version
// =============================================================================

/**
 * Raw Node.js version from .node-version file (e.g., "22.13.1")
 */
export const nodeVersionRaw = readFileSync(NODE_VERSION_FILE, 'utf8').trim()

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
 *
 * @returns {string} The build mode ('dev' or 'prod')
 */
// oxlint-disable-next-line socket/sort-source-methods -- file is grouped by section header banners ("Path Constants" / "Build Constants" / ...) with helpers co-located with their constants; autofix bails on the const-interleaved layout and reordering would scatter related declarations across sections.
export function getBuildMode(args?: string[] | Set<string>): string {
  // Explicit --prod / --dev CLI flags win over env.
  if (args) {
    const has = Array.isArray(args)
      ? (flag: string) => args.includes(flag)
      : (flag: string) => args.has(flag)
    if (has('--prod')) {
      return 'prod'
    }
    if (has('--dev')) {
      return 'dev'
    }
  }
  if (process.env['BUILD_MODE']) {
    return process.env['BUILD_MODE']
  }
  return getCI() ? 'prod' : 'dev'
}

/**
 * Get platform-specific build directory path. Returns
 * build/${BUILD_MODE}/${platformArch} for complete isolation between
 * platforms.
 *
 * This prevents race conditions when multiple platforms build concurrently by
 * giving each platform its own build directory for checkpoints, object files,
 * and intermediate artifacts.
 *
 * @param {string} packageDir - The package directory path.
 * @param {string} platformArch - Platform-arch string (e.g., 'linux-x64',
 *   'darwin-arm64')
 *
 * @returns {string} Platform-specific build directory path
 */
// oxlint-disable-next-line socket/sort-source-methods -- file is grouped by section header banners ("Path Constants" / "Build Constants" / ...) with helpers co-located with their constants; autofix bails on the const-interleaved layout and reordering would scatter related declarations across sections.
export function getPlatformBuildDir(
  packageDir: string,
  platformArch: string,
): string {
  const buildMode = getBuildMode()
  return `${packageDir}/build/${buildMode}/${platformArch}`
}

/**
 * Get Emscripten SDK search paths for the current or specified platform.
 *
 * @param {string} [platform] - Platform override (darwin, linux, win32)
 *
 * @returns {string[]} Array of paths to search for EMSDK
 */
// oxlint-disable-next-line socket/sort-source-methods -- file is grouped by section header banners ("Path Constants" / "Build Constants" / ...) with helpers co-located with their constants; autofix bails on the const-interleaved layout and reordering would scatter related declarations across sections.
export function getEmsdkSearchPaths(
  platform: string = process.platform,
): string[] {
  return (
    (EMSDK_SEARCH_PATHS as Record<string, string[]>)[platform] ||
    EMSDK_SEARCH_PATHS.linux
  )
}

/**
 * Get GCC path for a specific version.
 *
 * @param {number} version - GCC version number.
 *
 * @returns {string} Path to versioned GCC
 */
// oxlint-disable-next-line socket/sort-source-methods -- file is grouped by section header banners ("Path Constants" / "Build Constants" / ...) with helpers co-located with their constants; autofix bails on the const-interleaved layout and reordering would scatter related declarations across sections.
export function getGccPath(version: number): string {
  return COMPILER_PATHS.linux.gccVersioned(version)
}

/**
 * Get G++ path for a specific version.
 *
 * @param {number} version - G++ version number.
 *
 * @returns {string} Path to versioned G++
 */
// oxlint-disable-next-line socket/sort-source-methods -- file is grouped by section header banners ("Path Constants" / "Build Constants" / ...) with helpers co-located with their constants; autofix bails on the const-interleaved layout and reordering would scatter related declarations across sections.
export function getGxxPath(version: number): string {
  return COMPILER_PATHS.linux.gxxVersioned(version)
}

// =============================================================================
// Compressed Binary Format Constants
// =============================================================================

// Split into ./compressed-binary-format-constants.mts (max-file-lines soft
// cap) — re-exported here so existing `from './constants.mts'` imports keep
// working unchanged.
export * from './compressed-binary-format-constants.mts'
