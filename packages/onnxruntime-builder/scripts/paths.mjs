/**
 * Centralized path resolution for onnxruntime-builder.
 *
 * This is the source of truth for all build paths.
 */

import path from 'node:path'

import { BUILD_STAGES } from 'build-infra/lib/constants'
import { createPathBuilder } from 'build-infra/lib/path-builder'

const paths = createPathBuilder(import.meta.url)

// Package root: scripts/../
export const PACKAGE_ROOT = paths.packageRoot

// Build directories
export const BUILD_ROOT = paths.buildRoot

// Upstream path
export const UPSTREAM_PATH = paths.join('upstream/onnxruntime')

/**
 * Get shared build directories for pristine artifacts (shared across dev/prod).
 * Used for source-cloned checkpoint that both dev and prod extract from.
 */
export function getSharedBuildPaths() {
  const basePaths = paths.sharedBuildPaths()
  const { sourceDir } = basePaths

  // Shared source file paths (used during cloning)
  const cmakeDepsFile = path.join(sourceDir, 'cmake', 'deps.txt')
  const cmakeListsFile = path.join(sourceDir, 'cmake', 'CMakeLists.txt')
  const cmakeWebassemblyFile = path.join(
    sourceDir,
    'cmake',
    'onnxruntime_webassembly.cmake',
  )
  const postBuildSourceFile = path.join(
    sourceDir,
    'js',
    'web',
    'script',
    'wasm_post_build.js',
  )

  return {
    ...basePaths,
    cmakeDepsFile,
    cmakeListsFile,
    cmakeWebassemblyFile,
    postBuildSourceFile,
  }
}

/**
 * Get build directories for a specific mode (dev/prod).
 */
export function getBuildPaths(mode) {
  const standardPaths = paths.buildPaths(mode, { subdirs: ['out'] })
  const { buildDir, sourceDir } = standardPaths

  // Output directories (aligned with checkpoint names)
  const outDir = path.join(buildDir, 'out')
  const outputReleaseDir = path.join(outDir, BUILD_STAGES.RELEASE)
  const outputOptimizedDir = path.join(outDir, BUILD_STAGES.OPTIMIZED)
  const outputSyncDir = path.join(outDir, BUILD_STAGES.SYNC)
  const outputFinalDir = path.join(outDir, BUILD_STAGES.FINAL)

  // Source file paths
  const cmakeDepsFile = path.join(sourceDir, 'cmake', 'deps.txt')
  const cmakeListsFile = path.join(sourceDir, 'cmake', 'CMakeLists.txt')
  const buildScriptFile = path.join(sourceDir, 'build.sh')

  // WASM output file paths (final distribution)
  const outputWasmFile = path.join(outputFinalDir, 'ort.wasm')
  const outputMjsFile = path.join(outputFinalDir, 'ort.mjs')
  const outputSyncJsFile = path.join(outputFinalDir, 'ort-sync.js')

  return {
    ...standardPaths,
    buildScriptFile,
    cmakeDepsFile,
    cmakeListsFile,
    outDir,
    outputFinalDir,
    outputMjsFile,
    outputOptimizedDir,
    outputReleaseDir,
    outputSyncDir,
    outputSyncJsFile,
    outputWasmFile,
  }
}

/**
 * Get build output paths (platform-dependent).
 *
 * NOTE: Unlike other builder packages, ONNX Runtime's CMake build system
 * organizes outputs into platform-specific directories (build/MacOS/Release
 * on macOS, build/Linux/Release on Linux). This is the official ONNX Runtime
 * build structure, not something we added.
 *
 * @param {string} sourceDir - Mode-specific source directory
 * @param {string} platform - 'darwin' or 'linux'
 * @returns {object} Build output paths
 */
export function getBuildOutputPaths(sourceDir, platform = process.platform) {
  const platformName = platform === 'darwin' ? 'MacOS' : 'Linux'
  const buildOutputDir = path.join(
    sourceDir,
    'build',
    platformName,
    BUILD_STAGES.RELEASE,
  )
  const buildWasmFile = path.join(buildOutputDir, 'ort-wasm-simd-threaded.wasm')
  const buildMjsFile = path.join(buildOutputDir, 'ort-wasm-simd-threaded.mjs')
  const buildPostBuildScriptFile = path.join(
    buildOutputDir,
    'wasm_post_build.js',
  )
  const buildCmakeCacheFile = path.join(buildOutputDir, 'CMakeCache.txt')

  return {
    buildCmakeCacheFile,
    buildMjsFile,
    buildOutputDir,
    buildPostBuildScriptFile,
    buildWasmFile,
  }
}
