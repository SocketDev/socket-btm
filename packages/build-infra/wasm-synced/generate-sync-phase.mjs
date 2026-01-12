/**
 * Shared WASM sync wrapper generation phase.
 *
 * Generates synchronous wrapper for WASM modules across different packages.
 */

import { existsSync, promises as fs } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

import { safeDelete, safeMkdir } from '@socketsecurity/lib/fs'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { hasKeys } from '@socketsecurity/lib/objects'
import { getFileSize } from 'build-infra/lib/build-helpers'
import { createCheckpoint, shouldRun } from 'build-infra/lib/checkpoint-manager'
import { generateWasmSyncWrapper } from 'build-infra/wasm-synced/wasm-sync-wrapper'

const logger = getDefaultLogger()

/**
 * Generate synchronous wrapper for WASM.
 *
 * @param {object} options - Sync generation options
 * @param {string} options.buildDir - Build directory
 * @param {string} options.buildMode - Build mode ('prod' or 'dev')
 * @param {string} options.outputReleaseDir - Release output directory
 * @param {string} options.outputOptimizedDir - Optimized output directory
 * @param {string} options.outputSyncDir - Sync output directory
 * @param {boolean} options.forceRebuild - Force rebuild (ignore checkpoints)
 * @param {object} options.packageConfig - Package-specific configuration
 * @param {string} options.packageConfig.packageName - Package name (e.g., 'yoga-layout', 'onnxruntime')
 * @param {string} options.packageConfig.exportName - Export name (e.g., 'yoga', 'ort')
 * @param {string} options.packageConfig.initFunctionName - Init function name (e.g., 'Module', 'ortWasmThreaded')
 * @param {string} options.packageConfig.description - Build description for wrapper
 * @param {number|function} options.packageConfig.expectedExports - Expected export count (number or function of buildMode)
 * @param {string} options.packageConfig.fileBaseName - Base file name (defaults to exportName)
 */
export async function generateSync(options) {
  const {
    buildDir,
    buildMode,
    forceRebuild,
    outputOptimizedDir,
    outputReleaseDir,
    outputSyncDir,
    packageConfig,
  } = options

  if (!(await shouldRun(buildDir, '', 'wasm-synced', forceRebuild))) {
    return
  }

  logger.step('Generating Synchronous WASM Wrapper')
  logger.log(
    'Creating CommonJS synchronous wrapper from ESM async WASM module...',
  )
  logger.logNewline()

  const _require = createRequire(import.meta.url)

  // Extract package-specific config.
  const {
    description,
    expectedExports,
    exportName,
    fileBaseName = exportName,
    initFunctionName,
    packageName,
  } = packageConfig

  // Clean Sync directory before copying to ensure only intended files are archived.
  await safeDelete(outputSyncDir)
  await safeMkdir(outputSyncDir)

  // Determine source directory (Optimized for prod, Release for dev).
  const sourceDir = buildMode === 'prod' ? outputOptimizedDir : outputReleaseDir
  const inputWasmFile = path.join(sourceDir, `${fileBaseName}.wasm`)
  const inputMjsFile = path.join(sourceDir, `${fileBaseName}.mjs`)

  // Copy to Sync directory.
  const syncWasmFile = path.join(outputSyncDir, `${fileBaseName}.wasm`)
  const syncMjsFile = path.join(outputSyncDir, `${fileBaseName}.mjs`)
  const syncJsFile = path.join(outputSyncDir, `${fileBaseName}-sync.cjs`)

  await fs.copyFile(inputWasmFile, syncWasmFile)
  if (existsSync(inputMjsFile)) {
    await fs.copyFile(inputMjsFile, syncMjsFile)
  }

  // Generate synchronous wrapper with embedded WASM using shared utility.
  await generateWasmSyncWrapper({
    customSmokeTest: async (syncJsFilePath, logger) => {
      // Custom smoke test: Verify the file exists and is not empty.
      if (!existsSync(syncJsFilePath)) {
        throw new Error('Sync JS file not found')
      }

      const syncStats = await fs.stat(syncJsFilePath)
      if (syncStats.size === 0) {
        throw new Error('Sync JS file is empty')
      }

      logger.substep(
        `Sync JS file valid (${(syncStats.size / 1024).toFixed(2)} KB)`,
      )
    },
    description,
    exportName,
    initFunctionName,
    logger,
    mjsFile: syncMjsFile,
    outputSyncJs: syncJsFile,
    packageName,
    wasmFile: syncWasmFile,
  })

  const syncSize = await getFileSize(syncJsFile)
  logger.substep(`Sync wrapper: ${syncJsFile}`)
  logger.substep(`Sync wrapper size: ${syncSize}`)
  logger.logNewline()

  // Create checkpoint with smoke test.
  await createCheckpoint(
    buildDir,
    'wasm-synced',
    async () => {
      // Smoke test: Verify sync wrapper loads and initializes without runtime errors.
      const syncStats = await fs.stat(syncJsFile)
      if (syncStats.size === 0) {
        throw new Error('Sync wrapper file is empty')
      }

      // Load the sync wrapper to catch initialization errors.
      const wasmModule = _require(syncJsFile)

      // Verify module loaded (must be object, NOT a Promise).
      if (
        wasmModule === null ||
        wasmModule === undefined ||
        typeof wasmModule !== 'object'
      ) {
        throw new Error(
          `Sync wrapper failed to load properly: got ${typeof wasmModule}`,
        )
      }

      // Sync wrapper must NOT return a Promise.
      const isPromise = typeof wasmModule.then === 'function'
      if (isPromise) {
        throw new Error(
          'Sync wrapper should not return a Promise - async keyword was not removed from Module function',
        )
      }

      // Verify expected export count.
      const exportCount = Object.keys(wasmModule).length
      const expected =
        typeof expectedExports === 'function'
          ? expectedExports(buildMode)
          : expectedExports

      if (!hasKeys(wasmModule)) {
        throw new Error('Sync wrapper has no exports')
      }

      if (exportCount !== expected) {
        throw new Error(
          `Sync wrapper has ${exportCount} exports, expected ${expected} (mode: ${buildMode})`,
        )
      }

      logger.substep(
        `Sync wrapper loaded successfully with ${exportCount} exports`,
      )
    },
    {
      artifactPath: outputSyncDir,
      binaryPath: path.relative(buildDir, outputSyncDir),
      binarySize: syncSize,
    },
  )

  logger.success('Synchronous wrapper generated')
  logger.logNewline()
}
