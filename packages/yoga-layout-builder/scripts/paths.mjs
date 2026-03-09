/**
 * Centralized path resolution for yoga-layout-builder.
 *
 * This is the source of truth for all build paths.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { BUILD_STAGES } from 'build-infra/lib/constants'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Package root: scripts/../
export const PACKAGE_ROOT = path.resolve(__dirname, '..')

// Source files
export const BINDINGS_FILE = path.join(PACKAGE_ROOT, 'src', 'yoga-wasm.cpp')

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
 * Get build directories for a specific mode (dev/prod).
 */
export function getBuildPaths(mode) {
  const buildDir = path.join(BUILD_ROOT, mode)
  const sourceDir = path.join(buildDir, 'source')
  const checkpointsDir = path.join(buildDir, 'checkpoints')
  const cmakeDir = path.join(buildDir, 'cmake')

  // Output directories (aligned with checkpoint names)
  const outDir = path.join(buildDir, 'out')
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
  const outputSyncJsFile = path.join(outputFinalDir, 'yoga-sync.cjs')

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
    outputSyncDir,
    outputSyncJsFile,
    outputWasmFile,
    sourceDir,
    staticLibFile,
    wasmFile,
  }
}
