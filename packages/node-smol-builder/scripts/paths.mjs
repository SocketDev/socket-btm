/**
 * Centralized path resolution for node-smol-builder.
 *
 * Supports hierarchical organization:
 * - Phase: common, release, stripped, compressed, final
 * - Specificity: shared → platform/shared → platform/arch
 *
 * Note: Path helpers return all potential paths regardless of whether they exist.
 * Non-existent paths are safe to use with find/glob operations (they're simply skipped).
 * Use getExistingPaths() to filter to only existing directories when needed.
 */

import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { BUILD_STAGES, CHECKPOINTS } from 'build-infra/lib/constants'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Package root: scripts/../
export const PACKAGE_ROOT = path.resolve(__dirname, '..')

// Monorepo root: packages/../..
export const MONOREPO_ROOT = path.resolve(PACKAGE_ROOT, '..', '..')

// Global cache directory (shared with socket-cli).
export const SOCKET_CACHE_DIR = path.join(homedir(), '.socket')

// Upstream path
export const UPSTREAM_PATH = path.join(PACKAGE_ROOT, 'upstream/node')

/**
 * Get build directories for a specific mode (dev/prod).
 * @param {string} mode - Build mode ('dev' or 'prod')
 * @param {string} platform - Target platform ('darwin', 'linux', 'win32')
 */
export function getBuildPaths(mode, platform = process.platform) {
  const buildDir = path.join(BUILD_ROOT, mode)
  const nodeSourceDir = path.join(buildDir, 'source')
  const outDir = path.join(nodeSourceDir, 'out')
  const releaseDir = path.join(outDir, BUILD_STAGES.RELEASE)
  const buildPatchesDir = path.join(buildDir, 'patches')
  const buildOutDir = path.join(buildDir, 'out')
  const outputReleaseDir = path.join(buildOutDir, BUILD_STAGES.RELEASE)
  const outputStrippedDir = path.join(buildOutDir, BUILD_STAGES.STRIPPED)
  const outputCompressedDir = path.join(buildOutDir, BUILD_STAGES.COMPRESSED)
  const outputFinalDir = path.join(buildOutDir, BUILD_STAGES.FINAL)
  const cacheDir = path.join(buildDir, '.cache')

  // Platform-specific binary name
  const binaryName = platform === 'win32' ? 'node.exe' : 'node'

  // Node output is a directory (like curl, mbedtls) containing the binary.
  const outputReleaseNodeDir = path.join(outputReleaseDir, 'node')
  const outputStrippedNodeDir = path.join(outputStrippedDir, 'node')
  const outputCompressedNodeDir = path.join(outputCompressedDir, 'node')
  const outputFinalNodeDir = path.join(outputFinalDir, 'node')

  return {
    buildDir,
    nodeSourceDir,
    outDir,
    releaseDir,
    buildPatchesDir,
    buildOutDir,
    outputReleaseDir,
    outputReleaseNodeDir,
    outputStrippedDir,
    outputStrippedNodeDir,
    outputCompressedDir,
    outputCompressedNodeDir,
    outputFinalDir,
    outputFinalNodeDir,
    cacheDir,
    // Binary paths
    binaryName,
    nodeBinary: path.join(releaseDir, binaryName),
    outputReleaseBinary: path.join(outputReleaseNodeDir, binaryName),
    outputStrippedBinary: path.join(outputStrippedNodeDir, binaryName),
    outputCompressedBinary: path.join(outputCompressedNodeDir, binaryName),
    outputFinalBinary: path.join(outputFinalNodeDir, binaryName),
    // Test and validation file paths
    testFile: path.join(nodeSourceDir, 'deps/v8/src/heap/cppgc/heap-page.h'),
    bootstrapFile: path.join(nodeSourceDir, 'lib/internal/bootstrap/node.js'),
    patchedFile: path.join(nodeSourceDir, 'src/node_binding.cc'),
    // Build config directories
    releaseConfigDir: path.join(nodeSourceDir, 'Release'),
    debugConfigDir: path.join(nodeSourceDir, 'Debug'),
  }
}

/**
 * Get all source file paths that affect a build phase.
 *
 * Returns paths for scripts, patches, and additions that should be hashed
 * for cache key generation.
 *
 * @param {string} phase - 'binary-released' | 'binary-stripped' | 'binary-compressed' | 'finalized'
 * @param {string} platform - 'darwin' | 'linux' | 'win32'
 * @param {string} arch - 'arm64' | 'x64'
 * @returns {object} Object with scripts, patches, and additions paths
 *
 * @example
 * getBuildSourcePaths('stripped', 'darwin', 'arm64')
 * // Returns:
 * // {
 * //   common: [...common script paths],
 * //   scripts: [...stripped script paths],
 * //   patches: [...cumulative patch paths (release + stripped)],
 * //   additions: [...cumulative addition paths (release + stripped)]
 * // }
 */
export function getBuildSourcePaths(phase, platform, arch) {
  // Define phase dependencies.
  const phaseDeps = {
    [CHECKPOINTS.SOURCE_COPIED]: [CHECKPOINTS.SOURCE_COPIED],
    [CHECKPOINTS.SOURCE_PATCHED]: [
      CHECKPOINTS.SOURCE_COPIED,
      CHECKPOINTS.SOURCE_PATCHED,
    ],
    [CHECKPOINTS.BINARY_RELEASED]: [
      CHECKPOINTS.SOURCE_COPIED,
      CHECKPOINTS.SOURCE_PATCHED,
      CHECKPOINTS.BINARY_RELEASED,
    ],
    [CHECKPOINTS.BINARY_STRIPPED]: [
      CHECKPOINTS.SOURCE_COPIED,
      CHECKPOINTS.SOURCE_PATCHED,
      CHECKPOINTS.BINARY_RELEASED,
      CHECKPOINTS.BINARY_STRIPPED,
    ],
    [CHECKPOINTS.BINARY_COMPRESSED]: [
      CHECKPOINTS.SOURCE_COPIED,
      CHECKPOINTS.SOURCE_PATCHED,
      CHECKPOINTS.BINARY_RELEASED,
      CHECKPOINTS.BINARY_STRIPPED,
      CHECKPOINTS.BINARY_COMPRESSED,
    ],
    [CHECKPOINTS.FINALIZED]: [
      CHECKPOINTS.SOURCE_COPIED,
      CHECKPOINTS.SOURCE_PATCHED,
      CHECKPOINTS.BINARY_RELEASED,
      CHECKPOINTS.BINARY_STRIPPED,
      CHECKPOINTS.BINARY_COMPRESSED,
      CHECKPOINTS.FINALIZED,
    ],
  }

  const phases = phaseDeps[phase] || [phase]

  return {
    // Common scripts affect all phases
    common: getCommonScriptsPaths(platform, arch),

    // Phase-specific scripts (only current phase, not cumulative)
    scripts: getHierarchicalPaths('scripts', phase, platform, arch),

    // Patches and additions are cumulative (include all previous phases)
    patches: getCumulativeHierarchicalPaths('patches', phases, platform, arch),
    additions: getCumulativeHierarchicalPaths(
      'additions',
      phases,
      platform,
      arch,
    ),
  }
}

/**
 * Get common scripts paths (used by all phases).
 *
 * @param {string} platform - 'darwin' | 'linux' | 'win32'
 * @param {string} arch - 'arm64' | 'x64'
 * @returns {string[]} Array of common script paths
 */
export function getCommonScriptsPaths(platform, arch) {
  return getHierarchicalPaths('scripts', 'common', platform, arch)
}

/**
 * Get all source file paths for cumulative cache hash (includes all dependencies).
 *
 * For cache validation, we need to include all files from current phase and
 * all previous phases (cumulative).
 *
 * @param {string} phase - 'binary-released' | 'binary-stripped' | 'binary-compressed' | 'finalized'
 * @param {string} platform - 'darwin' | 'linux' | 'win32'
 * @param {string} arch - 'arm64' | 'x64'
 * @returns {object} Object with cumulative scripts, patches, and additions paths
 */
export function getCumulativeBuildSourcePaths(phase, platform, arch) {
  // Define phase dependencies.
  const phaseDeps = {
    [CHECKPOINTS.SOURCE_COPIED]: [CHECKPOINTS.SOURCE_COPIED],
    [CHECKPOINTS.SOURCE_PATCHED]: [
      CHECKPOINTS.SOURCE_COPIED,
      CHECKPOINTS.SOURCE_PATCHED,
    ],
    [CHECKPOINTS.BINARY_RELEASED]: [
      CHECKPOINTS.SOURCE_COPIED,
      CHECKPOINTS.SOURCE_PATCHED,
      CHECKPOINTS.BINARY_RELEASED,
    ],
    [CHECKPOINTS.BINARY_STRIPPED]: [
      CHECKPOINTS.SOURCE_COPIED,
      CHECKPOINTS.SOURCE_PATCHED,
      CHECKPOINTS.BINARY_RELEASED,
      CHECKPOINTS.BINARY_STRIPPED,
    ],
    [CHECKPOINTS.BINARY_COMPRESSED]: [
      CHECKPOINTS.SOURCE_COPIED,
      CHECKPOINTS.SOURCE_PATCHED,
      CHECKPOINTS.BINARY_RELEASED,
      CHECKPOINTS.BINARY_STRIPPED,
      CHECKPOINTS.BINARY_COMPRESSED,
    ],
    [CHECKPOINTS.FINALIZED]: [
      CHECKPOINTS.SOURCE_COPIED,
      CHECKPOINTS.SOURCE_PATCHED,
      CHECKPOINTS.BINARY_RELEASED,
      CHECKPOINTS.BINARY_STRIPPED,
      CHECKPOINTS.BINARY_COMPRESSED,
      CHECKPOINTS.FINALIZED,
    ],
  }

  const phases = phaseDeps[phase] || [phase]

  return {
    // Common scripts affect all phases
    common: getCommonScriptsPaths(platform, arch),

    // All scripts from all phases (cumulative)
    scripts: getCumulativeHierarchicalPaths('scripts', phases, platform, arch),

    // All patches from all phases (cumulative)
    patches: getCumulativeHierarchicalPaths('patches', phases, platform, arch),

    // All additions from all phases (cumulative)
    additions: getCumulativeHierarchicalPaths(
      'additions',
      phases,
      platform,
      arch,
    ),
  }
}

/**
 * Get all hierarchical paths for multiple phases (cumulative).
 *
 * Each phase includes its own files plus all previous phases.
 * Returns all potential paths regardless of existence.
 *
 * @param {string} category - 'scripts' | 'patches' | 'additions'
 * @param {string[]} phases - Array of phases to include (e.g., ['release', 'stripped'])
 * @param {string} platform - 'darwin' | 'linux' | 'win32'
 * @param {string} arch - 'arm64' | 'x64'
 * @returns {string[]} Array of all paths for all phases
 *
 * @example
 * getCumulativeHierarchicalPaths('patches', ['release', 'stripped'], 'linux', 'x64')
 * // Returns:
 * // [
 * //   'patches/release/shared',
 * //   'patches/release/linux/shared',
 * //   'patches/release/linux/x64',
 * //   'patches/stripped/shared',
 * //   'patches/stripped/linux/shared',
 * //   'patches/stripped/linux/x64'
 * // ]
 */
export function getCumulativeHierarchicalPaths(
  category,
  phases,
  platform,
  arch,
) {
  const allPaths = []

  for (const phase of phases) {
    const phasePaths = getHierarchicalPaths(category, phase, platform, arch)
    allPaths.push(...phasePaths)
  }

  return allPaths
}

/**
 * Filter paths to only those that exist.
 *
 * Essential for local build operations that use readdirSync/statSync
 * (these throw errors on non-existent directories).
 *
 * CI workflows don't need this (find handles missing dirs gracefully),
 * but local builds do.
 *
 * @param {string[]} paths - Array of paths to filter
 * @returns {string[]} Array of paths that exist on the filesystem
 *
 * @example
 * const allPaths = getHierarchicalPaths('scripts', 'stripped', 'darwin', 'arm64')
 * const existingPaths = getExistingPaths(allPaths)
 * // Returns only paths that actually exist:
 * // [
 * //   'packages/node-smol-builder/scripts/stripped/darwin/shared'
 * // ]
 */
export function getExistingPaths(paths) {
  return paths.filter(p => existsSync(p))
}

/**
 * Get hierarchical paths for scripts/patches/additions.
 *
 * Returns all potential paths in priority order, regardless of whether they exist.
 * Non-existent paths are safe to use with find/glob operations (they're simply skipped).
 *
 * For a given phase and platform/arch, returns paths in priority order:
 * 1. shared/ (all platforms)
 * 2. {platform}/shared/ (all archs of that platform)
 * 3. {platform}/{arch}/ (specific platform+arch)
 *
 * @param {string} category - 'scripts' | 'patches' | 'additions'
 * @param {string} phase - 'common' | 'release' | 'stripped' | 'compressed' | 'final'
 * @param {string} platform - 'darwin' | 'linux' | 'win32'
 * @param {string} arch - 'arm64' | 'x64'
 * @returns {string[]} Array of paths in priority order (general to specific)
 *
 * @example
 * getHierarchicalPaths('scripts', 'stripped', 'darwin', 'arm64')
 * // Returns:
 * // [
 * //   'packages/node-smol-builder/scripts/stripped/shared',
 * //   'packages/node-smol-builder/scripts/stripped/darwin/shared',
 * //   'packages/node-smol-builder/scripts/stripped/darwin/arm64'
 * // ]
 * // Note: Paths are returned even if directories don't exist
 */
export function getHierarchicalPaths(category, phase, platform, arch) {
  const base = path.join(PACKAGE_ROOT, category, phase)

  return [
    // Level 1: All platforms
    path.join(base, 'shared'),
    // Level 2: All archs of platform
    path.join(base, platform, 'shared'),
    // Level 3: Specific platform+arch
    path.join(base, platform, arch),
  ]
}

/**
 * Get shared build directories for pristine artifacts (shared across dev/prod).
 * Used for source-cloned checkpoint that both dev and prod extract from.
 */
export function getSharedBuildPaths() {
  const buildDir = path.join(BUILD_ROOT, 'shared')
  const nodeSourceDir = path.join(buildDir, 'source')
  const checkpointsDir = path.join(buildDir, 'checkpoints')

  return {
    buildDir,
    nodeSourceDir,
    checkpointsDir,
    configureScript: path.join(nodeSourceDir, 'configure'),
  }
}

// Note: Checkpoint-specific paths have been moved to respective checkpoint paths.mjs files:
// - PATCHES_SOURCE_PATCHED_DIR, ADDITIONS_MAPPINGS → binary-released/shared/paths.mjs
// - COMPRESS_BINARY_SCRIPT → binary-compressed/shared/paths.mjs
// This ensures checkpoint-specific paths are tracked in cache keys appropriately.

// External monorepo packages
export const BINPRESS_DIR = path.join(PACKAGE_ROOT, '..', 'binpress')
export const BINFLATE_DIR = path.join(PACKAGE_ROOT, '..', 'binflate')
export const BINJECT_DIR = path.join(PACKAGE_ROOT, '..', 'binject')
export const BIN_INFRA_DIR = path.join(PACKAGE_ROOT, '..', 'bin-infra')
export const BUILD_INFRA_DIR = path.join(PACKAGE_ROOT, '..', 'build-infra')

// Build output directories
export const BINJECTED_DIR = path.join(
  PACKAGE_ROOT,
  'scripts',
  'binary-compressed',
  'shared',
  'binjected',
)

// Build directories
export const BUILD_ROOT = path.join(PACKAGE_ROOT, 'build')
