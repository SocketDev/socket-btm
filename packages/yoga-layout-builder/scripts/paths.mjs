/**
 * Centralized path resolution for yoga-layout-builder.
 *
 * This is the source of truth for all build paths.
 */

import path from 'node:path'

import { createPathBuilder } from 'build-infra/lib/path-builder'

const paths = createPathBuilder(import.meta.url)

// Package root: scripts/../
export const PACKAGE_ROOT = paths.packageRoot

// Source files
export const SRC_DIR = paths.srcRoot
export const BINDINGS_FILE = paths.joinSrc('yoga-wasm.cpp')

// Build directories
export const BUILD_ROOT = paths.buildRoot

// Submodule path
export const SUBMODULE_PATH = paths.join('submodule')

/**
 * Get shared build directories for pristine artifacts (shared across dev/prod).
 * Used for source-cloned checkpoint that both dev and prod extract from.
 */
export function getSharedBuildPaths() {
  return paths.sharedBuildPaths()
}

/**
 * Get build directories for a specific mode (dev/prod).
 */
export function getBuildPaths(mode) {
  const standardPaths = paths.buildPaths(mode, { subdirs: ['cmake', 'out'] })
  const { buildDir, cmakeDir, sourceDir } = standardPaths

  // Output directories (aligned with checkpoint names)
  const outDir = path.join(buildDir, 'out')
  const outputReleaseDir = path.join(outDir, 'Release')
  const outputOptimizedDir = path.join(outDir, 'Optimized')
  const outputSyncDir = path.join(outDir, 'Sync')
  const outputFinalDir = path.join(outDir, 'Final')

  // Source file paths
  const cmakeListsFile = path.join(sourceDir, 'CMakeLists.txt')

  // Build artifact paths
  const staticLibFile = path.join(cmakeDir, 'yoga', 'libyogacore.a')
  const wasmFile = path.join(cmakeDir, 'yoga.wasm')
  const jsFile = path.join(cmakeDir, 'yoga.js')

  // WASM output file paths (final distribution)
  const outputWasmFile = path.join(outputFinalDir, 'yoga.wasm')
  const outputMjsFile = path.join(outputFinalDir, 'yoga.mjs')
  const outputSyncJsFile = path.join(outputFinalDir, 'yoga-sync.js')

  return {
    ...standardPaths,
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
    staticLibFile,
    wasmFile,
  }
}
