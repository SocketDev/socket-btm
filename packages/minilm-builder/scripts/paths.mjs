/**
 * Centralized path resolution for minilm-builder.
 *
 * This is the source of truth for all build paths.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Package root: scripts/../
export const PACKAGE_ROOT = path.resolve(__dirname, '..')

// Python scripts directory
export const PYTHON_DIR = path.join(PACKAGE_ROOT, 'python')

// Build root
export const BUILD_ROOT = path.join(PACKAGE_ROOT, 'build')

/**
 * Get build directories for a specific quantization level (int4/int8).
 *
 * @param {string} quantLevel - 'int4' or 'int8'
 * @returns {object} Build paths
 */
export function getBuildPaths(quantLevel) {
  const buildDir = path.join(BUILD_ROOT, quantLevel)
  const modelsDir = path.join(buildDir, 'models')
  const cacheDir = path.join(buildDir, 'cache')

  return {
    buildDir,
    modelsDir,
    cacheDir,
  }
}

/**
 * Get model-specific paths for a given model and quantization level.
 *
 * @param {string} quantLevel - 'int4' or 'int8'
 * @param {string} modelName - Model output name (e.g., 'minilm')
 * @returns {object} Model paths
 */
export function getModelPaths(quantLevel, modelName) {
  const { cacheDir, modelsDir } = getBuildPaths(quantLevel)

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
    onnxModelDir,
    onnxModelFile,
    optimizedModelDir,
    optimizedModelFile,
    quantizedModelDir,
    quantizedModelFile,
    tokenizerDir,
    finalModelFile,
  }
}
