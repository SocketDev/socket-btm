/**
 * Centralized path resolution for yoga-layout-builder.
 *
 * This is the source of truth for all build paths.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Package root: scripts/../
export const PACKAGE_ROOT = path.resolve(__dirname, '..')

// Source files
export const SRC_DIR = path.join(PACKAGE_ROOT, 'src')
export const BINDINGS_FILE = path.join(SRC_DIR, 'yoga-wasm.cpp')

// Build directories
export const BUILD_ROOT = path.join(PACKAGE_ROOT, 'build')

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
    sourceDir,
    checkpointsDir,
  }
}

/**
 * Get build directories for a specific mode (dev/prod).
 */
export function getBuildPaths(mode) {
  const buildDir = path.join(BUILD_ROOT, mode)
  const sourceDir = path.join(buildDir, 'source')
  const cmakeDir = path.join(buildDir, 'cmake')
  const wasmDir = path.join(buildDir, 'wasm')
  const checkpointsDir = path.join(buildDir, 'checkpoints')

  // Source file paths
  const cmakeListsFile = path.join(sourceDir, 'CMakeLists.txt')

  // Build artifact paths
  const staticLibFile = path.join(cmakeDir, 'yoga', 'libyogacore.a')
  const wasmFile = path.join(cmakeDir, 'yoga.wasm')
  const jsFile = path.join(cmakeDir, 'yoga.js')

  // Final output files
  const outputWasmFile = path.join(wasmDir, 'yoga.wasm')
  const outputMjsFile = path.join(wasmDir, 'yoga.mjs')
  const outputSyncJsFile = path.join(wasmDir, 'yoga-sync.js')

  return {
    buildDir,
    sourceDir,
    cmakeDir,
    wasmDir,
    checkpointsDir,
    cmakeListsFile,
    staticLibFile,
    wasmFile,
    jsFile,
    outputWasmFile,
    outputMjsFile,
    outputSyncJsFile,
  }
}
