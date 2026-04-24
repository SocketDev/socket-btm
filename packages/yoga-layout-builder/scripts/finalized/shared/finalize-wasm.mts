/**
 * WASM finalization phase for Yoga Layout
 *
 * Copies final artifacts to Final directory for distribution.
 */

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'

import { getFileSize } from 'build-infra/lib/build-helpers'
import { restoreCheckpoint } from 'build-infra/lib/checkpoint-manager'
import { CHECKPOINTS } from 'build-infra/lib/constants'

import { safeDelete, safeMkdir } from '@socketsecurity/lib/fs'
import { getDefaultLogger } from '@socketsecurity/lib/logger'

const logger = getDefaultLogger()

/**
 * Copy final artifacts to Final directory for distribution.
 * Orchestrated by build-pipeline; returns checkpoint metadata instead of
 * writing the checkpoint directly.
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

  const syncWasmFile = path.join(outputSyncDir, 'yoga.wasm')
  const syncMjsFile = path.join(outputSyncDir, 'yoga.mjs')
  const syncJsFile = path.join(outputSyncDir, 'yoga-sync.cjs')
  const syncEsmFile = path.join(outputSyncDir, 'yoga-sync.mjs')

  if (!existsSync(syncWasmFile)) {
    logger.log('Sync files not found, restoring from wasm-synced checkpoint...')
    const restored = await restoreCheckpoint(
      buildDir,
      '',
      CHECKPOINTS.WASM_SYNCED,
      { destDir: buildDir },
    )
    if (!restored || !existsSync(syncWasmFile)) {
      throw new Error(
        'Failed to restore Sync directory from wasm-synced checkpoint',
      )
    }
    logger.substep('Sync files restored from checkpoint')
    logger.logNewline()
  }

  await safeDelete(outputFinalDir)
  await safeMkdir(outputFinalDir)

  await fs.copyFile(syncWasmFile, outputWasmFile)
  if (existsSync(syncMjsFile)) {
    await fs.copyFile(syncMjsFile, outputMjsFile)
  }
  await fs.copyFile(syncJsFile, outputSyncJsFile)

  const outputSyncEsmFile = path.join(outputFinalDir, 'yoga-sync.mjs')
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
    binaryPath: path.relative(buildDir, outputFinalDir),
    binarySize: `${wasmSize}, ${syncSize}`,
    smokeTest: async () => {
      const wasmBuffer = await fs.readFile(outputWasmFile)
      const magic = wasmBuffer.slice(0, 4).toString('hex')
      if (magic !== '0061736d') {
        throw new Error('Invalid WASM file (bad magic number)')
      }
      const wasmStats = await fs.stat(outputWasmFile)
      if (wasmStats.size < 100_000) {
        throw new Error(
          `WASM file too small: ${wasmStats.size} bytes (expected >100KB)`,
        )
      }
      const syncStats = await fs.stat(outputSyncJsFile)
      if (syncStats.size === 0) {
        throw new Error('Sync wrapper file is empty')
      }
    },
  }
}
