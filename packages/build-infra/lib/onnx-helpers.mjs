/**
 * ONNX model validation and utility functions.
 *
 * Provides common validation logic for ONNX protobuf files to ensure
 * models are valid before processing.
 */

import { promises as fs } from 'node:fs'

/**
 * Validate an ONNX model file.
 *
 * Checks:
 * - File is not empty (minimum 100 bytes)
 * - Valid ONNX protobuf magic number (0x08 or 0x0a)
 *
 * @param {string} filePath - Path to ONNX model file
 * @param {string} modelType - Description of model (e.g., 'encoder', 'decoder')
 * @throws {Error} If validation fails
 */
export async function validateOnnxFile(filePath, modelType = 'model') {
  const buffer = await fs.readFile(filePath)

  if (buffer.length < 100) {
    throw new Error(
      `${modelType} file too small to be valid ONNX (${buffer.length} bytes)`,
    )
  }

  const magic = buffer[0]
  if (magic !== 0x08 && magic !== 0x0a) {
    throw new Error(
      `Invalid ONNX ${modelType} protobuf header (expected 0x08 or 0x0a, got 0x${magic.toString(16)})`,
    )
  }
}

/**
 * Validate multiple ONNX model files.
 *
 * @param {Array<{path: string, type: string}>} models - Array of models to validate
 * @throws {Error} If any validation fails
 */
export async function validateOnnxFiles(models) {
  await Promise.all(
    models.map(model => validateOnnxFile(model.path, model.type)),
  )
}
