/**
 * WASM finalization phase for ONNX Runtime
 *
 * Copies final artifacts to Final directory for distribution.
 */

import { existsSync, promises as fs } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

import { getFileSize } from 'build-infra/lib/build-helpers'
import { createCheckpoint, shouldRun } from 'build-infra/lib/checkpoint-manager'
import { CHECKPOINTS } from 'build-infra/lib/constants'

import { safeDelete, safeMkdir } from '@socketsecurity/lib/fs'
import { getDefaultLogger } from '@socketsecurity/lib/logger'

const logger = getDefaultLogger()

/**
 * Copy final artifacts to Final directory for distribution.
 *
 * @param {object} options - Finalization options
 * @param {string} options.buildDir - Build directory
 * @param {string} options.outputSyncDir - Sync directory (source)
 * @param {string} options.outputFinalDir - Final directory (destination)
 * @param {string} options.outputWasmFile - Final WASM file path
 * @param {string} options.outputMjsFile - Final MJS file path
 * @param {string} options.outputSyncJsFile - Final sync JS file path
 * @param {boolean} options.forceRebuild - Force rebuild (ignore checkpoints)
 */
export async function finalizeWasm(options) {
  const {
    buildDir,
    forceRebuild,
    outputFinalDir,
    outputMjsFile,
    outputSyncDir,
    outputSyncJsFile,
    outputWasmFile,
  } = options

  if (!(await shouldRun(buildDir, '', CHECKPOINTS.FINALIZED, forceRebuild))) {
    return
  }

  logger.step('Finalizing WASM for Distribution')
  logger.log('Copying final artifacts to dev/out/Final...')
  logger.logNewline()

  // Copy from Sync directory to Final
  const syncWasmFile = path.join(outputSyncDir, 'ort.wasm')
  const syncMjsFile = path.join(outputSyncDir, 'ort.mjs')
  const syncJsFile = path.join(outputSyncDir, 'ort-sync.cjs')
  const syncEsmFile = path.join(outputSyncDir, 'ort-sync.mjs')

  // If Sync directory doesn't exist, restore from wasm-synced checkpoint
  if (!existsSync(syncWasmFile)) {
    logger.log('Sync files not found, restoring from wasm-synced checkpoint...')
    const { restoreCheckpoint } = await import(
      'build-infra/lib/checkpoint-manager'
    )
    const restored = await restoreCheckpoint(
      buildDir,
      '',
      CHECKPOINTS.WASM_SYNCED,
      {
        destDir: buildDir,
      },
    )
    if (!restored || !existsSync(syncWasmFile)) {
      throw new Error(
        'Failed to restore Sync directory from wasm-synced checkpoint',
      )
    }
    logger.substep('Sync files restored from checkpoint')
    logger.logNewline()
  }

  // Clean Final directory before copying to ensure only intended files are archived
  await safeDelete(outputFinalDir)
  await safeMkdir(outputFinalDir)

  await fs.copyFile(syncWasmFile, outputWasmFile)
  if (existsSync(syncMjsFile)) {
    await fs.copyFile(syncMjsFile, outputMjsFile)
  }
  await fs.copyFile(syncJsFile, outputSyncJsFile)

  // Copy ESM sync wrapper (.mjs)
  const outputSyncEsmFile = path.join(outputFinalDir, 'ort-sync.mjs')
  if (existsSync(syncEsmFile)) {
    await fs.copyFile(syncEsmFile, outputSyncEsmFile)
  }

  const wasmSize = await getFileSize(outputWasmFile)
  const syncSize = await getFileSize(outputSyncJsFile)

  logger.substep(`WASM: ${outputWasmFile} (${wasmSize})`)
  logger.substep(`MJS: ${outputMjsFile}`)
  logger.substep(`Sync wrapper: ${outputSyncJsFile} (${syncSize})`)
  logger.logNewline()

  // Create checkpoint with smoke test.
  await createCheckpoint(
    buildDir,
    CHECKPOINTS.FINALIZED,
    async () => {
      // Smoke test: Verify all files exist and are valid.
      const wasmBuffer = await fs.readFile(outputWasmFile)
      const magic = wasmBuffer.slice(0, 4).toString('hex')
      if (magic !== '0061736d') {
        throw new Error('Invalid WASM file (bad magic number)')
      }

      // Validate WASM file size (should be >1MB for valid build)
      const wasmStats = await fs.stat(outputWasmFile)
      if (wasmStats.size < 1_000_000) {
        throw new Error(
          `WASM file too small: ${wasmStats.size} bytes (expected >1MB)`,
        )
      }

      const _require = createRequire(import.meta.url)
      const syncModule = _require(outputSyncJsFile)
      if (!syncModule) {
        throw new Error('Sync module failed to load')
      }

      logger.substep('Final artifacts validated')
    },
    {
      binarySize: `${wasmSize}, ${syncSize}`,
      binaryPath: path.relative(buildDir, outputWasmFile),
      artifactPath: outputFinalDir,
    },
  )

  logger.success('WASM finalized for distribution')
  logger.logNewline()
}
