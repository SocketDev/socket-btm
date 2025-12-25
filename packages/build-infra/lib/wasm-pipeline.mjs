/**
 * Shared WASM pipeline utilities.
 *
 * Provides common build pipeline steps for WASM modules:
 * - Optimization with wasm-opt
 * - Synchronous wrapper generation
 * - Finalization (copy to output)
 *
 * This eliminates duplication across onnxruntime-builder and yoga-layout-builder
 * where these modules were 95-99% identical.
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'

import { safeMkdir } from '@socketsecurity/lib/fs'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

import { formatDuration, getFileSize } from './build-helpers.mjs'
import { ensureToolInstalled } from './tool-installer.mjs'
import { validateWasmFile } from './wasm-helpers.mjs'
import { generateSyncCjs } from '../wasm-synced/generate-sync-cjs.mjs'
import { generateSyncEsm } from '../wasm-synced/generate-sync-esm.mjs'

const logger = getDefaultLogger()

/**
 * Format bytes as human-readable size string.
 * @param {number} bytes - Size in bytes
 * @returns {string} Formatted size (e.g., "1.5 MB")
 */
function formatSize(bytes) {
  const units = ['B', 'KB', 'MB', 'GB']
  let size = bytes
  let unitIndex = 0
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex++
  }
  return `${size.toFixed(2)} ${units[unitIndex]}`
}

/**
 * Optimize a WASM file with wasm-opt.
 *
 * @param {object} options - Optimization options
 * @param {string} options.inputFile - Input WASM file path
 * @param {string} options.outputFile - Output WASM file path
 * @param {string[]} options.flags - wasm-opt optimization flags
 * @param {string} options.packageName - Package name for logging
 * @param {string} options.mode - Build mode ('dev' or 'prod')
 * @returns {Promise<void>}
 */
export async function optimizeWasm(options) {
  const { flags, inputFile, mode, outputFile } = options

  const startTime = Date.now()

  logger.log('')
  logger.step(`Optimizing WASM (${mode} mode)`)

  // Ensure wasm-opt is installed
  logger.substep('Checking for wasm-opt...')
  const wasmOptResult = await ensureToolInstalled('wasm-opt', {
    autoInstall: true,
  })

  if (!wasmOptResult.available) {
    throw new Error('wasm-opt is required but not available')
  }

  // Validate input
  await validateWasmFile(inputFile)
  const inputSize = await getFileSize(inputFile)
  logger.log(`Input size: ${formatSize(inputSize)}`)

  // Run wasm-opt
  logger.substep('Running wasm-opt...')
  const result = await spawn('wasm-opt', [
    ...flags,
    inputFile,
    '-o',
    outputFile,
  ])

  if (result.code !== 0) {
    throw new Error(`wasm-opt failed with code ${result.code}`)
  }

  // Validate output
  await validateWasmFile(outputFile)
  const outputSize = await getFileSize(outputFile)
  const reduction = ((1 - outputSize / inputSize) * 100).toFixed(1)

  logger.success('WASM optimized')
  logger.log(`Output size: ${formatSize(outputSize)} (${reduction}% reduction)`)
  logger.log(`Time: ${formatDuration(Date.now() - startTime)}`)
  logger.log('')
}

/**
 * Generate synchronous wrappers for a WASM module.
 *
 * @param {object} options - Generation options
 * @param {string} options.inputFile - Input WASM file path
 * @param {string} options.mjsFile - Output .mjs file path
 * @param {string} options.cjsFile - Output .js (CommonJS) file path
 * @param {string} options.exportName - Main export name (e.g., 'createOrtRuntime', 'createYoga')
 * @param {string} options.initFunctionName - Init function name (e.g., 'initOrt', 'initYoga')
 * @param {string} options.packageName - Package name for logging
 * @param {string} options.mode - Build mode ('dev' or 'prod')
 * @param {Function} [options.smokeTest] - Optional smoke test function
 * @returns {Promise<void>}
 */
export async function generateSyncWrappers(options) {
  const {
    cjsFile,
    exportName,
    initFunctionName,
    inputFile,
    mjsFile,
    mode,
    packageName,
    smokeTest,
  } = options

  const startTime = Date.now()

  logger.log('')
  logger.step(`Generating Synchronous Wrappers (${mode} mode)`)

  // Validate input
  await validateWasmFile(inputFile)

  // Read WASM
  const wasmBuffer = await fs.readFile(inputFile)
  logger.log(`WASM size: ${formatSize(wasmBuffer.length)}`)

  // Generate ESM wrapper
  logger.substep('Generating ESM wrapper...')
  const esmCode = await generateSyncEsm({
    wasmBuffer,
    exportName,
    initFunctionName,
  })
  await fs.writeFile(mjsFile, esmCode, 'utf-8')
  logger.log(`ESM: ${mjsFile}`)

  // Generate CJS wrapper
  logger.substep('Generating CJS wrapper...')
  const cjsCode = await generateSyncCjs({
    wasmBuffer,
    exportName,
    initFunctionName,
  })
  await fs.writeFile(cjsFile, cjsCode, 'utf-8')
  logger.log(`CJS: ${cjsFile}`)

  // Run smoke test if provided
  if (smokeTest) {
    logger.substep('Running smoke test...')
    await smokeTest(mjsFile, mode, packageName)
    logger.success('Smoke test passed')
  }

  logger.success('Synchronous wrappers generated')
  logger.log(`Time: ${formatDuration(Date.now() - startTime)}`)
  logger.log('')
}

/**
 * Finalize WASM build by copying files to output directory.
 *
 * @param {object} options - Finalization options
 * @param {string} options.wasmFile - Source WASM file
 * @param {string} options.mjsFile - Source .mjs file
 * @param {string} options.cjsFile - Source .js (CommonJS) file
 * @param {string} options.outputDir - Output directory
 * @param {string} options.outputWasmName - Output WASM filename (e.g., 'ort.wasm', 'yoga.wasm')
 * @param {string} options.outputMjsName - Output .mjs filename
 * @param {string} options.outputCjsName - Output .js filename
 * @param {string} options.packageName - Package name for logging
 * @param {string} options.mode - Build mode ('dev' or 'prod')
 * @returns {Promise<void>}
 */
export async function finalizeWasm(options) {
  const {
    cjsFile,
    mjsFile,
    mode,
    outputCjsName,
    outputDir,
    outputMjsName,
    outputWasmName,
    wasmFile,
  } = options

  const startTime = Date.now()

  logger.log('')
  logger.step(`Finalizing WASM Build (${mode} mode)`)

  // Create output directory
  await safeMkdir(outputDir)

  // Copy files
  const outputWasmFile = path.join(outputDir, outputWasmName)
  const outputMjsFile = path.join(outputDir, outputMjsName)
  const outputCjsFile = path.join(outputDir, outputCjsName)

  logger.substep('Copying files...')
  await fs.copyFile(wasmFile, outputWasmFile)
  await fs.copyFile(mjsFile, outputMjsFile)
  await fs.copyFile(cjsFile, outputCjsFile)

  const wasmSize = await getFileSize(outputWasmFile)
  const mjsSize = await getFileSize(outputMjsFile)
  const cjsSize = await getFileSize(outputCjsFile)

  logger.success('Files copied to output directory')
  logger.log(`WASM: ${formatSize(wasmSize)}`)
  logger.log(`ESM:  ${formatSize(mjsSize)}`)
  logger.log(`CJS:  ${formatSize(cjsSize)}`)
  logger.log(`Output: ${outputDir}`)
  logger.log(`Time: ${formatDuration(Date.now() - startTime)}`)
  logger.log('')
}
