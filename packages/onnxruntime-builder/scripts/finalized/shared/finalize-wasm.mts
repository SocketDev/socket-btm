/**
 * WASM finalization phase for ONNX Runtime
 *
 * Copies final artifacts to Final directory for distribution.
 */

import { existsSync, promises as fs } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

import { getFileSize } from 'build-infra/lib/build-helpers'
import { restoreCheckpoint } from 'build-infra/lib/checkpoint-manager'
import { CHECKPOINTS } from 'build-infra/lib/constants'

import { safeDelete, safeMkdir } from '@socketsecurity/lib/fs'
import { getDefaultLogger } from '@socketsecurity/lib/logger'

const logger = getDefaultLogger()

/**
 * Copy final artifacts to Final directory for distribution.
 *
 * @param {object} options
 * @param {string} options.buildDir
 * @param {string} options.outputSyncDir
 * @param {string} options.outputFinalDir
 * @param {string} options.outputWasmFile
 * @param {string} options.outputMjsFile
 * @param {string} options.outputSyncJsFile
 */
export async function finalizeWasm(options) {
  const {
    buildDir,
    outputFinalDir,
    outputMjsFile,
    outputSyncDir,
    outputSyncJsFile,
    outputWasmFile,
  } = options

  logger.log('Copying final artifacts to out/Final...')
  logger.logNewline()

  // Copy from Sync directory to Final
  const syncWasmFile = path.join(outputSyncDir, 'ort.wasm')
  const syncMjsFile = path.join(outputSyncDir, 'ort.mjs')
  const syncJsFile = path.join(outputSyncDir, 'ort-sync.cjs')
  const syncEsmFile = path.join(outputSyncDir, 'ort-sync.mjs')

  // If Sync directory doesn't exist, restore from wasm-synced checkpoint
  if (!existsSync(syncWasmFile)) {
    logger.log('Sync files not found, restoring from wasm-synced checkpoint...')
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

  return {
    artifactPath: outputFinalDir,
    binaryPath: path.relative(buildDir, outputWasmFile),
    binarySize: `${wasmSize}, ${syncSize}`,
    smokeTest: async () => {
      const wasmBuffer = await fs.readFile(outputWasmFile)
      const magic = wasmBuffer.slice(0, 4).toString('hex')
      if (magic !== '0061736d') {
        throw new Error('Invalid WASM file (bad magic number)')
      }
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
    },
  }
}
