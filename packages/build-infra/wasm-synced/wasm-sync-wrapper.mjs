/**
 * Generate synchronous WASM wrapper with embedded base64 binary.
 *
 * This utility eliminates duplicate WASM sync wrapper generation logic
 * across builder packages (onnxruntime-builder, yoga-layout-builder).
 *
 * It handles:
 * - Reading WASM binary and converting to base64
 * - Generating both CommonJS (.js) and ESM (.mjs) synchronous wrappers
 * - Smoke testing the generated wrappers
 */

import { existsSync } from 'node:fs'
import fs from 'node:fs/promises'

import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { generateSyncCjs } from './generate-sync-cjs.mjs'
import { generateSyncEsm } from './generate-sync-esm.mjs'

/**
 * Generate a synchronous WASM wrapper with embedded base64 binary.
 *
 * @param {object} options - Configuration options
 * @param {string} options.wasmFile - Path to input WASM file
 * @param {string} options.mjsFile - Path to input MJS glue code file
 * @param {string} options.outputSyncJs - Path to output sync.js file
 * @param {string} options.packageName - Package name (e.g., 'onnxruntime', 'yoga-layout')
 * @param {string} options.initFunctionName - Name of the Emscripten init function (e.g., 'ortWasmThreaded', 'Module')
 * @param {string} options.exportName - Name of the exported object (e.g., 'ort', 'yoga')
 * @param {string} [options.description] - Optional description for the file header
 * @param {object} [options.logger] - Optional logger (defaults to build-output logger)
 * @param {Function} [options.customSmokeTest] - Optional custom smoke test function for sync.js
 * @returns {Promise<void>}
 */
export async function generateWasmSyncWrapper(options) {
  const {
    customSmokeTest,
    description,
    exportName,
    initFunctionName,
    logger = getDefaultLogger(),
    mjsFile,
    outputSyncJs,
    packageName,
    wasmFile,
  } = { __proto__: null, ...options }

  if (!existsSync(wasmFile)) {
    throw new Error(`WASM file not found: ${wasmFile}`)
  }

  if (!existsSync(mjsFile)) {
    throw new Error(`MJS glue code file not found: ${mjsFile}`)
  }

  logger.substep('Generating synchronous wrappers with embedded WASM...')

  // Read WASM binary and convert to base64
  const wasmBinary = await fs.readFile(wasmFile)
  const base64Wasm = wasmBinary.toString('base64')
  const mjsContent = await fs.readFile(mjsFile, 'utf-8')

  // Generate CommonJS wrapper (.js)
  await generateSyncCjs({
    base64Wasm,
    description,
    exportName,
    initFunctionName,
    logger,
    mjsContent,
    mjsFile,
    outputSyncJs,
    packageName,
    wasmBinary,
  })

  // Generate ESM wrapper (.mjs)
  const outputSyncMjs = outputSyncJs.replace(/\.js$/, '.mjs')
  await generateSyncEsm({
    base64Wasm,
    description,
    exportName,
    initFunctionName,
    logger,
    mjsContent,
    mjsFile,
    outputSyncMjs,
    packageName,
    wasmBinary,
  })

  // Smoke test both sync.js and sync.mjs files
  logger.substep(`Smoke testing ${outputSyncJs.split('/').pop()}...`)

  if (customSmokeTest) {
    // Use custom smoke test if provided
    await customSmokeTest(outputSyncJs, logger)
  } else {
    // Default smoke test: Just verify the file exists and is not empty
    if (!existsSync(outputSyncJs)) {
      throw new Error('Sync JS file not found after generation')
    }

    const syncStats = await fs.stat(outputSyncJs)
    if (syncStats.size === 0) {
      throw new Error('Sync JS file is empty')
    }

    logger.substep(
      `Sync JS file valid (${(syncStats.size / 1024).toFixed(2)} KB)`,
    )
  }

  // Smoke test the sync.mjs file (ESM version)
  logger.substep(`Smoke testing ${outputSyncMjs.split('/').pop()}...`)

  if (customSmokeTest) {
    // Use custom smoke test if provided (same test, different file)
    await customSmokeTest(outputSyncMjs, logger)
  } else {
    // Default smoke test: Just verify the file exists and is not empty
    if (!existsSync(outputSyncMjs)) {
      throw new Error('Sync MJS file not found after generation')
    }

    const syncMjsStats = await fs.stat(outputSyncMjs)
    if (syncMjsStats.size === 0) {
      throw new Error('Sync MJS file is empty')
    }

    logger.substep(
      `Sync MJS file valid (${(syncMjsStats.size / 1024).toFixed(2)} KB)`,
    )
  }

  logger.success('WASM sync wrappers generated (CJS + ESM)')
}
