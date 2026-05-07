/**
 * Shared path helpers for build infrastructure.
 *
 * These centralize path segments that would otherwise be hand-built across
 * packages — most notably the `build/downloaded` cache directory and the
 * binsuite `out/Final/<binary>` final-binary location. Per the
 * "One Path, One Reference" rule, every consumer imports from here instead
 * of joining the segments inline.
 */

import path from 'node:path'

import { BUILD_STAGES } from './constants.mts'

/**
 * Get the canonical download cache directory for a package.
 *
 * Used by builders that fetch prebuilt artifacts from GitHub releases as a
 * fallback to building from source. Each package has its own download cache
 * rooted at `{packageRoot}/build/downloaded`; consumers compose subdirectories
 * (per-tool, per-platformArch) on top of the base.
 *
 * @param {string} packageRoot - Absolute path to the package root.
 * @returns {string} Absolute path to the package's download cache directory.
 */
export function getDownloadedDir(packageRoot) {
  return path.join(packageRoot, 'build', 'downloaded')
}

/**
 * Get the canonical final-binary path for a binsuite tool
 * (binpress, binflate, binject) for a specific build mode and platform.
 *
 * Mirrors the layout produced by `bin-infra/lib/builder.mts`'s
 * `buildBinSuitePackage`: `{packageRoot}/build/{mode}/{platformArch}/out/Final/{binaryName}`.
 * Use this whenever a non-builder consumer (script, test helper, sibling
 * package) needs to find the output of a binsuite build.
 *
 * @param {string} packageRoot - Absolute path to the binsuite package root.
 * @param {string} mode - Build mode (`'dev'` or `'prod'`).
 * @param {string} platformArch - Platform-arch identifier (e.g. `'darwin-arm64'`).
 * @param {string} binaryName - Binary file name (e.g. `'binpress'`, `'binpress.exe'`).
 * @returns {string} Absolute path to the final binary.
 */
export function getFinalBinaryPath(packageRoot, mode, platformArch, binaryName) {
  return path.join(
    packageRoot,
    'build',
    mode,
    platformArch,
    'out',
    BUILD_STAGES.FINAL,
    binaryName,
  )
}
