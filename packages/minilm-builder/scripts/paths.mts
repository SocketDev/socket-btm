/**
 * Centralized path resolution for minilm-builder.
 *
 * This is the source of truth for all build paths.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { getCurrentPlatformArch } from 'build-infra/lib/platform-mappings'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Package root: scripts/../
export const PACKAGE_ROOT = path.resolve(__dirname, '..')

// Python scripts directory
export const PYTHON_DIR = path.join(PACKAGE_ROOT, 'python')

// Build root
export const BUILD_ROOT = path.join(PACKAGE_ROOT, 'build')

/**
 * Get build directories for a specific mode, platform-arch, and quantization level.
 *
 * @param {string} mode - Build mode ('dev' or 'prod')
 * @param {string} platformArch - Platform-arch (e.g., 'darwin-arm64') - REQUIRED
 * @param {string} quantLevel - 'int4' or 'int8'
 * @returns {object} Build paths
 */
export function getBuildPaths(mode, platformArch, quantLevel) {
  if (!platformArch) {
    throw new Error('platformArch is required for getBuildPaths()')
  }

  const buildDir = path.join(BUILD_ROOT, mode, platformArch, quantLevel)
  const modelsDir = path.join(buildDir, 'models')
  const cacheDir = path.join(buildDir, 'cache')

  return {
    buildDir,
    cacheDir,
    modelsDir,
  }
}

/**
 * Get the current platform identifier using shared utility.
 * Handles musl detection and respects TARGET_ARCH environment variable.
 */
export async function getCurrentPlatform() {
  return await getCurrentPlatformArch()
}

/**
 * Get model-specific paths for a given model, mode, platform-arch, and quantization level.
 *
 * @param {string} mode - Build mode ('dev' or 'prod')
 * @param {string} platformArch - Platform-arch (e.g., 'darwin-arm64') - REQUIRED
 * @param {string} quantLevel - 'int4' or 'int8'
 * @param {string} modelName - Model output name (e.g., 'minilm')
 * @returns {object} Model paths
 */
export function getModelPaths(mode, platformArch, quantLevel, modelName) {
  const { cacheDir, modelsDir } = getBuildPaths(mode, platformArch, quantLevel)

  const cacheModelDir = path.join(cacheDir, modelName)
  const onnxModelDir = path.join(modelsDir, `${modelName}-onnx`)
  const optimizedModelDir = path.join(modelsDir, `${modelName}-optimized`)
  const quantizedModelDir = path.join(modelsDir, `${modelName}-quantized`)
  const tokenizerDir = path.join(modelsDir, `${modelName}-tokenizer`)

  const onnxModelFile = path.join(onnxModelDir, 'model.onnx')
  const optimizedModelFile = path.join(optimizedModelDir, 'model.onnx')
  const quantizedModelFile = path.join(
    quantizedModelDir,
    'model_quantized.onnx',
  )
  const finalModelFile = path.join(modelsDir, `${modelName}.onnx`)

  return {
    cacheModelDir,
    finalModelFile,
    onnxModelDir,
    onnxModelFile,
    optimizedModelDir,
    optimizedModelFile,
    quantizedModelDir,
    quantizedModelFile,
    tokenizerDir,
  }
}
