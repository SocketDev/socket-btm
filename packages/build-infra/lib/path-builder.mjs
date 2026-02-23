/**
 * Path builder utilities for standardizing path resolution across packages.
 *
 * This module eliminates duplicate path resolution boilerplate by providing:
 * - Common package root detection from script location
 * - Standard build directory structure helpers
 * - Reusable path construction patterns
 *
 * Usage:
 *   import { createPathBuilder } from 'build-infra/lib/path-builder'
 *   const paths = createPathBuilder(import.meta.url)
 *   export const PACKAGE_ROOT = paths.packageRoot
 *   export const BUILD_ROOT = paths.buildRoot
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Create a path builder for a package based on the script location.
 *
 * @param {string} importMetaUrl - The import.meta.url from the calling script
 * @param {object} [options] - Optional configuration
 * @param {string} [options.scriptsRelative='..'] - Relative path from scripts/ to package root
 * @returns {object} Path builder with common paths and helper functions
 */
export function createPathBuilder(importMetaUrl, options = {}) {
  const { scriptsRelative = '..' } = options

  // Convert import.meta.url to file path
  const __filename = fileURLToPath(importMetaUrl)
  const __dirname = path.dirname(__filename)

  // Package root: scripts/../ (or custom relative path)
  const packageRoot = path.resolve(__dirname, scriptsRelative)

  // Common root directories
  const buildRoot = path.join(packageRoot, 'build')
  const distRoot = path.join(packageRoot, 'dist')
  const srcRoot = path.join(packageRoot, 'src')

  return {
    // Core paths
    __dirname,
    __filename,
    buildRoot,
    distRoot,
    packageRoot,
    srcRoot,

    /**
     * Create build paths for a specific mode (dev/prod).
     *
     * @param {string} mode - Build mode ('dev', 'prod', etc.)
     * @param {object} [options] - Optional configuration
     * @param {string[]} [options.subdirs] - Additional subdirectories to create
     * @returns {object} Build paths
     */
    buildPaths(mode, options = {}) {
      const { subdirs = [] } = options

      const buildDir = path.join(buildRoot, mode)
      const sourceDir = path.join(buildDir, 'source')
      const checkpointsDir = path.join(buildDir, 'checkpoints')

      const result = {
        buildDir,
        checkpointsDir,
        sourceDir,
      }

      // Add requested subdirectories
      for (const subdir of subdirs) {
        result[`${subdir}Dir`] = path.join(buildDir, subdir)
      }

      return result
    },

    /**
     * Create shared build paths for artifacts shared across modes.
     *
     * @param {object} [options] - Optional configuration
     * @param {string[]} [options.subdirs] - Additional subdirectories to create
     * @returns {object} Shared build paths
     */
    sharedBuildPaths(options = {}) {
      const { subdirs = [] } = options

      const buildDir = path.join(buildRoot, 'shared')
      const sourceDir = path.join(buildDir, 'source')
      const checkpointsDir = path.join(buildDir, 'checkpoints')

      const result = {
        buildDir,
        checkpointsDir,
        sourceDir,
      }

      // Add requested subdirectories
      for (const subdir of subdirs) {
        result[`${subdir}Dir`] = path.join(buildDir, subdir)
      }

      return result
    },

    /**
     * Create WASM output paths for a specific mode.
     *
     * @param {string} mode - Build mode ('dev', 'prod', etc.)
     * @param {string} wasmName - Base name for WASM files (e.g., 'ort', 'yoga')
     * @returns {object} WASM output paths
     */
    wasmOutputPaths(mode, wasmName) {
      const wasmDir = path.join(buildRoot, mode, 'wasm')
      return {
        outputMjsFile: path.join(wasmDir, `${wasmName}.mjs`),
        outputSyncJsFile: path.join(wasmDir, `${wasmName}-sync.js`),
        outputWasmFile: path.join(wasmDir, `${wasmName}.wasm`),
        wasmDir,
      }
    },

    /**
     * Create model paths for a specific mode.
     *
     * @param {string} mode - Build mode ('dev', 'prod', etc.)
     * @returns {object} Model paths
     */
    modelPaths(mode) {
      const buildDir = path.join(buildRoot, mode)
      const modelsDir = path.join(buildDir, 'models')
      const distDir = path.join(distRoot, mode)

      return {
        buildDir,
        distDir,
        modelsDir,
      }
    },

    /**
     * Create distribution paths for a specific mode.
     *
     * @param {string} mode - Build mode ('dev', 'prod', etc.)
     * @returns {object} Distribution paths
     */
    distPaths(mode) {
      return {
        distDir: path.join(distRoot, mode),
        distRoot,
      }
    },

    /**
     * Join paths relative to package root.
     *
     * @param {...string} segments - Path segments to join
     * @returns {string} Absolute path
     */
    join(...segments) {
      return path.join(packageRoot, ...segments)
    },

    /**
     * Join paths relative to build root.
     *
     * @param {...string} segments - Path segments to join
     * @returns {string} Absolute path
     */
    joinBuild(...segments) {
      return path.join(buildRoot, ...segments)
    },

    /**
     * Join paths relative to source root.
     *
     * @param {...string} segments - Path segments to join
     * @returns {string} Absolute path
     */
    joinSrc(...segments) {
      return path.join(srcRoot, ...segments)
    },
  }
}
