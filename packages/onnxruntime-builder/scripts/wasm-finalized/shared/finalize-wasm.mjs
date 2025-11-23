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

  if (!(await shouldRun(buildDir, '', 'wasm-finalized', forceRebuild))) {
    return
  }

  logger.step('Finalizing WASM for Distribution')
  logger.log('Copying final artifacts to dev/out/Final...')
  logger.logNewline()

  await fs.mkdir(outputFinalDir, { recursive: true })

  // Copy from Sync directory to Final
  const syncWasmFile = path.join(outputSyncDir, 'ort.wasm')
  const syncMjsFile = path.join(outputSyncDir, 'ort.mjs')
  const syncJsFile = path.join(outputSyncDir, 'ort-sync.js')

  await fs.copyFile(syncWasmFile, outputWasmFile)
  if (existsSync(syncMjsFile)) {
    await fs.copyFile(syncMjsFile, outputMjsFile)
  }
  await fs.copyFile(syncJsFile, outputSyncJsFile)

  const wasmSize = await getFileSize(outputWasmFile)
  const syncSize = await getFileSize(outputSyncJsFile)

  logger.substep(`WASM: ${outputWasmFile} (${wasmSize})`)
  logger.substep(`MJS: ${outputMjsFile}`)
  logger.substep(`Sync wrapper: ${outputSyncJsFile} (${syncSize})`)
  logger.logNewline()

  // Create checkpoint with smoke test.
  await createCheckpoint(
    buildDir,
    '',
    'wasm-finalized',
    async () => {
      // Smoke test: Verify all files exist and are valid.
      const wasmBuffer = await fs.readFile(outputWasmFile)
      const magic = wasmBuffer.slice(0, 4).toString('hex')
      if (magic !== '0061736d') {
        throw new Error('Invalid WASM file (bad magic number)')
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
      binaryPath: path.relative(buildDir, outputFinalDir),
      artifactPath: outputFinalDir,
    },
  )

  logger.success('WASM finalized for distribution')
  logger.logNewline()
}
