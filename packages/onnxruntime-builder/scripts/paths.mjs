/**
 * Centralized path resolution for onnxruntime-builder.
 *
 * This is the source of truth for all build paths.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Package root: scripts/../
export const PACKAGE_ROOT = path.resolve(__dirname, '..')

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
    buildDir,
    sourceDir,
    checkpointsDir,
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
  const buildDir = path.join(BUILD_ROOT, mode)
  const sourceDir = path.join(buildDir, 'source')
  const wasmDir = path.join(buildDir, 'wasm')
  const checkpointsDir = path.join(buildDir, 'checkpoints')

  // Source file paths
  const cmakeDepsFile = path.join(sourceDir, 'cmake', 'deps.txt')
  const cmakeListsFile = path.join(sourceDir, 'cmake', 'CMakeLists.txt')
  const buildScriptFile = path.join(sourceDir, 'build.sh')

  // Build artifact paths
  const cmakeCacheFile = path.join(wasmDir, 'CMakeCache.txt')
  const postBuildScriptFile = path.join(wasmDir, 'wasm_post_build.js')

  // WASM output files
  const wasmSIMDFile = path.join(wasmDir, 'ort-wasm-simd-threaded.wasm')
  const wasmSIMDMjsFile = path.join(wasmDir, 'ort-wasm-simd-threaded.mjs')

  // Final output files
  const outputWasmFile = path.join(wasmDir, 'ort.wasm')
  const outputMjsFile = path.join(wasmDir, 'ort.mjs')
  const outputSyncJsFile = path.join(wasmDir, 'ort-sync.js')

  return {
    buildDir,
    sourceDir,
    wasmDir,
    checkpointsDir,
    cmakeDepsFile,
    cmakeListsFile,
    buildScriptFile,
    cmakeCacheFile,
    postBuildScriptFile,
    wasmSIMDFile,
    wasmSIMDMjsFile,
    outputWasmFile,
    outputMjsFile,
    outputSyncJsFile,
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
  const buildOutputDir = path.join(sourceDir, 'build', platformName, 'Release')
  const buildWasmFile = path.join(buildOutputDir, 'ort-wasm-simd-threaded.wasm')
  const buildMjsFile = path.join(buildOutputDir, 'ort-wasm-simd-threaded.mjs')
  const buildPostBuildScriptFile = path.join(
    buildOutputDir,
    'wasm_post_build.js',
  )
  const buildCmakeCacheFile = path.join(buildOutputDir, 'CMakeCache.txt')

  return {
    buildOutputDir,
    buildWasmFile,
    buildMjsFile,
    buildPostBuildScriptFile,
    buildCmakeCacheFile,
  }
}
