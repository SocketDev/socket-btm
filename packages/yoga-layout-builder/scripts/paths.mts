/**
 * Centralized path resolution for yoga-layout-builder.
 *
 * This is the source of truth for all build paths.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { BUILD_STAGES } from 'build-infra/lib/constants'
import { getCurrentPlatformArch } from 'build-infra/lib/platform-mappings'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Package root: scripts/../
export const PACKAGE_ROOT = path.resolve(__dirname, '..')

// Source files - use official yoga bindings from cloned source (matches yoga core version).
// These are resolved dynamically based on the build mode's source directory.
export function getBindingsPaths(sourceDir) {
  const bindingsDir = path.join(sourceDir, 'javascript/src')
  return {
    bindingsDir,
    bindingsFiles: [
      path.join(bindingsDir, 'embind.cpp'),
      path.join(bindingsDir, 'Node.cpp'),
      path.join(bindingsDir, 'Config.cpp'),
    ],
  }
}

// Build directories
export const BUILD_ROOT = path.join(PACKAGE_ROOT, 'build')

// Upstream path
export const UPSTREAM_PATH = path.join(PACKAGE_ROOT, 'upstream/yoga')

/**
 * Get shared build directories for pristine artifacts (shared across dev/prod).
 * Used for source-cloned checkpoint that both dev and prod extract from.
 */
export function getSharedBuildPaths() {
  const buildDir = path.join(BUILD_ROOT, 'shared')
  const sourceDir = path.join(buildDir, 'source')
  const checkpointsDir = path.join(buildDir, 'checkpoints')

  return {
    buildDir,
    checkpointsDir,
    sourceDir,
  }
}

/**
 * Get build directories for a specific mode (dev/prod) with REQUIRED platformArch.
 * @param {string} mode - Build mode ('dev' or 'prod')
 * @param {string} platformArch - Platform-arch (e.g., 'darwin-arm64') - REQUIRED
 */
export function getBuildPaths(mode, platformArch) {
  if (!platformArch) {
    throw new Error('platformArch is required for getBuildPaths()')
  }

  const buildDir = path.join(BUILD_ROOT, mode, platformArch)
  const sourceDir = path.join(buildDir, 'source')
  const checkpointsDir = path.join(buildDir, 'checkpoints')
  const cmakeDir = path.join(buildDir, 'cmake')

  // Wasm output partition: build/<mode>/<platform>/wasm/...
  // The platform leaf above stays host-specific because cmake/cargo
  // intermediates are host-specific; the wasm/ leaf below it makes the
  // wasm artifact obviously identifiable as wasm (vs native binaries
  // that share the same builder infrastructure).
  const wasmDir = path.join(buildDir, 'wasm')

  // Output directories (aligned with checkpoint names)
  const outDir = path.join(wasmDir, 'out')
  const outputReleaseDir = path.join(outDir, BUILD_STAGES.RELEASE)
  const outputOptimizedDir = path.join(outDir, BUILD_STAGES.OPTIMIZED)
  const outputSyncDir = path.join(outDir, BUILD_STAGES.SYNC)
  const outputFinalDir = path.join(outDir, BUILD_STAGES.FINAL)

  // Source file paths
  const cmakeListsFile = path.join(sourceDir, 'CMakeLists.txt')

  // Build artifact paths
  const staticLibFile = path.join(cmakeDir, 'yoga', 'libyogacore.a')
  const wasmFile = path.join(cmakeDir, 'yoga.wasm')
  const jsFile = path.join(cmakeDir, 'yoga.js')

  // WASM output file paths (final distribution)
  const outputWasmFile = path.join(outputFinalDir, 'yoga.wasm')
  const outputMjsFile = path.join(outputFinalDir, 'yoga.mjs')
  const outputSyncCjsFile = path.join(outputFinalDir, 'yoga-sync.cjs')
  const outputSyncMjsFile = path.join(outputFinalDir, 'yoga-sync.mjs')

  return {
    buildDir,
    checkpointsDir,
    cmakeDir,
    cmakeListsFile,
    jsFile,
    outDir,
    outputFinalDir,
    outputMjsFile,
    outputOptimizedDir,
    outputReleaseDir,
    outputSyncCjsFile,
    outputSyncDir,
    outputSyncMjsFile,
    outputWasmFile,
    sourceDir,
    staticLibFile,
    wasmDir,
    wasmFile,
  }
}

/**
 * Get the current platform identifier using shared utility.
 * Handles musl detection and respects TARGET_ARCH environment variable.
 */
export async function getCurrentPlatform() {
  return await getCurrentPlatformArch()
}
