/**
 * WebAssembly validation and utility functions.
 *
 * Provides common validation logic for WASM files to ensure
 * binaries are valid before processing.
 */

import { promises as fs } from 'node:fs'

/**
 * Validate a WebAssembly binary file.
 *
 * Checks:
 * - File has valid WASM magic number (0x0061736d / "\0asm")
 * - File is not empty
 *
 * @param {string} filePath - Path to WASM file
 * @throws {Error} If validation fails
 */
export async function validateWasmFile(filePath) {
  const buffer = await fs.readFile(filePath)

  if (buffer.length === 0) {
    throw new Error(`WASM file is empty: ${filePath}`)
  }

  const magic = buffer.slice(0, 4).toString('hex')
  if (magic !== '0061736d') {
    throw new Error(
      `Invalid WASM file magic number (expected 0x0061736d, got 0x${magic}): ${filePath}`,
    )
  }
}

/**
 * Validate and compile a WebAssembly module.
 *
 * This performs both binary validation and WebAssembly compilation
 * to ensure the module is valid and can be instantiated.
 *
 * @param {string} filePath - Path to WASM file
 * @returns {Promise<{module: WebAssembly.Module, exports: Array<{name: string, kind: string}>}>}
 * @throws {Error} If validation or compilation fails
 */
export async function validateAndCompileWasm(filePath) {
  await validateWasmFile(filePath)

  const buffer = await fs.readFile(filePath)
  const module = new WebAssembly.Module(buffer)
  const exports = WebAssembly.Module.exports(module)

  return { module, exports }
}

/**
 * Get WebAssembly module exports.
 *
 * @param {string} filePath - Path to WASM file
 * @returns {Promise<Array<{name: string, kind: string}>>}
 */
export async function getWasmExports(filePath) {
  const { exports } = await validateAndCompileWasm(filePath)
  return exports
}

/**
 * Validate WASM module has expected exports.
 *
 * @param {string} filePath - Path to WASM file
 * @param {string[]} expectedExports - Array of export names that must exist
 * @throws {Error} If any expected export is missing
 */
export async function validateWasmExports(filePath, expectedExports) {
  const exports = await getWasmExports(filePath)
  const exportNames = new Set(exports.map(e => e.name))

  const missing = expectedExports.filter(name => !exportNames.has(name))
  if (missing.length > 0) {
    throw new Error(
      `WASM module missing required exports: ${missing.join(', ')}`,
    )
  }
}
