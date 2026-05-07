/**
 * Centralized path resolution for onnxruntime-builder.
 *
 * This is the source of truth for all build paths.
 */

import path from 'node:path'
import process from 'node:process'

import { fileURLToPath } from 'node:url'

import { BUILD_STAGES } from 'build-infra/lib/constants'
import { getCurrentPlatformArch } from 'build-infra/lib/platform-mappings'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Package root: scripts/../
export const PACKAGE_ROOT = path.resolve(__dirname, '..')

// Build directories
export const BUILD_ROOT = path.join(PACKAGE_ROOT, 'build')

// Upstream path
export const UPSTREAM_PATH = path.join(PACKAGE_ROOT, 'upstream/onnxruntime')

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
  const buildScriptFile = path.join(
    sourceDir,
    process.platform === 'win32' ? 'build.bat' : 'build.sh',
  )

  return {
    buildDir,
    buildScriptFile,
    checkpointsDir,
    cmakeDepsFile,
    cmakeListsFile,
    cmakeWebassemblyFile,
    postBuildSourceFile,
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

  // Wasm output partition: build/<mode>/<platform>/wasm/...
  // The platform leaf above stays host-specific because cmake/cargo
  // intermediates are host-specific; the wasm/ leaf below makes the
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
  const cmakeDepsFile = path.join(sourceDir, 'cmake', 'deps.txt')
  const cmakeListsFile = path.join(sourceDir, 'cmake', 'CMakeLists.txt')
  const buildScriptFile = path.join(
    sourceDir,
    process.platform === 'win32' ? 'build.bat' : 'build.sh',
  )

  // WASM output file paths (final distribution)
  const outputWasmFile = path.join(outputFinalDir, 'ort.wasm')
  const outputMjsFile = path.join(outputFinalDir, 'ort.mjs')
  const outputSyncCjsFile = path.join(outputFinalDir, 'ort-sync.cjs')
  const outputSyncMjsFile = path.join(outputFinalDir, 'ort-sync.mjs')

  return {
    buildDir,
    buildScriptFile,
    checkpointsDir,
    cmakeDepsFile,
    cmakeListsFile,
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
    wasmDir,
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

/**
 * Get the current platform identifier using shared utility.
 * Handles musl detection and respects TARGET_ARCH environment variable.
 */
export async function getCurrentPlatform() {
  return await getCurrentPlatformArch()
}
