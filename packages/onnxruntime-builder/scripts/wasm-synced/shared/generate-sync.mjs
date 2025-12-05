/**
 * WASM sync wrapper generation phase for ONNX Runtime
 *
 * Generates synchronous wrapper for WASM module.
 */

import { existsSync, promises as fs } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

import { getFileSize } from 'build-infra/lib/build-helpers'
import { createCheckpoint, shouldRun } from 'build-infra/lib/checkpoint-manager'
import { generateWasmSyncWrapper } from 'build-infra/wasm-synced/wasm-sync-wrapper'

import { safeDelete } from '@socketsecurity/lib/fs'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { hasKeys } from '@socketsecurity/lib/objects'

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
 */
export async function generateSync(options) {
  const {
    buildDir,
    buildMode,
    forceRebuild,
    outputOptimizedDir,
    outputReleaseDir,
    outputSyncDir,
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

  // Clean Sync directory before copying to ensure only intended files are archived
  await safeDelete(outputSyncDir)
  await fs.mkdir(outputSyncDir, { recursive: true })

  // Determine source directory (Optimized for prod, Release for dev)
  const sourceDir = buildMode === 'prod' ? outputOptimizedDir : outputReleaseDir
  const inputWasmFile = path.join(sourceDir, 'ort.wasm')
  const inputMjsFile = path.join(sourceDir, 'ort.mjs')

  // Copy to Sync directory
  const syncWasmFile = path.join(outputSyncDir, 'ort.wasm')
  const syncMjsFile = path.join(outputSyncDir, 'ort.mjs')
  const syncJsFile = path.join(outputSyncDir, 'ort-sync.js')

  await fs.copyFile(inputWasmFile, syncWasmFile)
  if (existsSync(inputMjsFile)) {
    await fs.copyFile(inputMjsFile, syncMjsFile)
  }

  // Generate synchronous wrapper with embedded WASM using shared utility.
  await generateWasmSyncWrapper({
    customSmokeTest: async (syncJsFilePath, logger) => {
      // Custom smoke test: Verify the file exists and is not empty
      // We skip execution test due to Emscripten 4.x threading + SIMD runtime complexity
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
    description:
      'Built with WASM threading + SIMD for synchronous instantiation.',
    exportName: 'ort',
    initFunctionName: 'ortWasmThreaded',
    logger,
    mjsFile: syncMjsFile,
    outputSyncJs: syncJsFile,
    packageName: 'onnxruntime',
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
      // Smoke test: Verify sync wrapper loads and initializes without runtime errors
      const syncStats = await fs.stat(syncJsFile)
      if (syncStats.size === 0) {
        throw new Error('Sync wrapper file is empty')
      }

      // Load the sync wrapper to catch initialization errors
      const ortModule = _require(syncJsFile)

      // Verify module loaded (must be object, NOT a Promise)
      if (
        ortModule === null ||
        ortModule === undefined ||
        typeof ortModule !== 'object'
      ) {
        throw new Error(
          `Sync wrapper failed to load properly: got ${typeof ortModule}`,
        )
      }

      // Sync wrapper must NOT return a Promise
      const isPromise = typeof ortModule.then === 'function'
      if (isPromise) {
        throw new Error(
          'Sync wrapper should not return a Promise - async keyword was not removed from Module function',
        )
      }

      // Verify expected export count for ONNX Runtime
      const exportCount = Object.keys(ortModule).length
      // Both dev (Release) and prod (Optimized) builds have 50 exports
      // If optimization changes this in future, adjust accordingly
      const expectedExports = 50

      if (!hasKeys(ortModule)) {
        throw new Error('Sync wrapper has no exports')
      }

      if (exportCount !== expectedExports) {
        throw new Error(
          `Sync wrapper has ${exportCount} exports, expected ${expectedExports} (mode: ${buildMode})`,
        )
      }

      logger.substep(
        `Sync wrapper loaded successfully with ${exportCount} exports`,
      )
    },
    {
      binarySize: syncSize,
      binaryPath: path.relative(buildDir, outputSyncDir),
      artifactPath: outputSyncDir,
    },
  )

  logger.success('Synchronous wrapper generated')
  logger.logNewline()
}
