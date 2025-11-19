/**
 * Centralized path resolution for yoga-layout-builder.
 *
 * This is the source of truth for all build paths.
 */

import { createPathBuilder } from 'build-infra/lib/path-builder'

const paths = createPathBuilder(import.meta.url)

// Package root: scripts/../
export const PACKAGE_ROOT = paths.packageRoot

// Source files
export const SRC_DIR = paths.srcRoot
export const BINDINGS_FILE = paths.joinSrc('yoga-wasm.cpp')

// Build directories
export const BUILD_ROOT = paths.buildRoot

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
  const standardPaths = paths.buildPaths(mode, { subdirs: ['cmake'] })
  const wasmPaths = paths.wasmOutputPaths(mode, 'yoga')

  // Source file paths
  const cmakeListsFile = paths.join('build', mode, 'source', 'CMakeLists.txt')

  // Build artifact paths
  const staticLibFile = paths.join(
    'build',
    mode,
    'cmake',
    'yoga',
    'libyogacore.a',
  )
  const wasmFile = paths.join('build', mode, 'cmake', 'yoga.wasm')
  const jsFile = paths.join('build', mode, 'cmake', 'yoga.js')

  return {
    ...standardPaths,
    ...wasmPaths,
    cmakeListsFile,
    jsFile,
    staticLibFile,
    wasmFile,
  }
}
