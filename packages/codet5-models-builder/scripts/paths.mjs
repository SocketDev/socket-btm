/**
 * Centralized path resolution for codet5-models-builder.
 *
 * This is the source of truth for all build paths.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Package root: scripts/../
export const PACKAGE_ROOT = path.resolve(__dirname, '..')

// Build root
export const BUILD_ROOT = path.join(PACKAGE_ROOT, 'build')

// Shared models cache (same source models for both int8/int4)
export const MODELS_DIR = path.join(BUILD_ROOT, 'models')

/**
 * Get build directories for a specific mode and quantization level.
 *
 * @param {string} buildMode - 'dev' or 'prod'
 * @param {string} quantLevel - 'int4' or 'int8'
 * @returns {object} Build paths
 */
export function getBuildPaths(buildMode, quantLevel) {
  const buildDir = path.join(BUILD_ROOT, buildMode, quantLevel)
  const outputDir = path.join(buildDir, 'output')

  // Model file paths
  const tokenizerFile = path.join(MODELS_DIR, 'tokenizer.json')
  const configFile = path.join(MODELS_DIR, 'config.json')
  const encoderFile = path.join(buildDir, 'encoder_model.onnx')
  const decoderFile = path.join(buildDir, 'decoder_model.onnx')

  // Output file paths
  const outputEncoderFile = path.join(outputDir, 'encoder.onnx')
  const outputDecoderFile = path.join(outputDir, 'decoder.onnx')
  const outputTokenizerFile = path.join(outputDir, 'tokenizer.json')

  return {
    buildDir,
    outputDir,
    tokenizerFile,
    configFile,
    encoderFile,
    decoderFile,
    outputEncoderFile,
    outputDecoderFile,
    outputTokenizerFile,
  }
}
