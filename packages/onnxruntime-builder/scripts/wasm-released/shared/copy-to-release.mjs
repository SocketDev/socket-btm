/**
 * WASM release phase for ONNX Runtime
 *
 * Copies WASM from source build to Release directory.
 */

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'

import { getFileSize } from 'build-infra/lib/build-helpers'
import { printError } from 'build-infra/lib/build-output'
import { createCheckpoint, shouldRun } from 'build-infra/lib/checkpoint-manager'

import { safeDelete } from '@socketsecurity/lib/fs'
import { getDefaultLogger } from '@socketsecurity/lib/logger'

const logger = getDefaultLogger()

/**
 * Copy WASM from source build to Release directory.
 *
 * @param {object} options - Copy options
 * @param {string} options.buildDir - Build directory
 * @param {string} options.outputReleaseDir - Release output directory
 * @param {string} options.buildWasmFile - Source WASM file path
 * @param {string} options.buildMjsFile - Source MJS file path (optional)
 * @param {boolean} options.forceRebuild - Force rebuild (ignore checkpoints)
 */
export async function copyToRelease(options) {
  const {
    buildDir,
    buildMjsFile,
    buildWasmFile,
    forceRebuild,
    outputReleaseDir,
  } = options

  if (!(await shouldRun(buildDir, '', 'wasm-released', forceRebuild))) {
    return
  }

  logger.step('Copying WASM to Build Output (Release)')
  logger.log('Copying WASM artifacts from source build to dev/out/Release...')
  logger.logNewline()

  // Clean Release directory before copying to ensure only intended files are archived
  await safeDelete(outputReleaseDir)
  await fs.mkdir(outputReleaseDir, { recursive: true })

  if (!existsSync(buildWasmFile)) {
    printError('WASM file not found - build failed')
    printError(`Expected: ${buildWasmFile}`)
    throw new Error(`Required WASM file not found: ${buildWasmFile}`)
  }

  // Copy WASM file.
  const releaseWasmFile = path.join(outputReleaseDir, 'ort.wasm')
  await fs.copyFile(buildWasmFile, releaseWasmFile)

  // Copy original .mjs glue code (ES6 module format with threading).
  const releaseMjsFile = path.join(outputReleaseDir, 'ort.mjs')
  if (existsSync(buildMjsFile)) {
    await fs.copyFile(buildMjsFile, releaseMjsFile)
    logger.substep(`MJS: ${releaseMjsFile}`)
  }

  const wasmSize = await getFileSize(releaseWasmFile)
  logger.substep(`WASM: ${releaseWasmFile}`)
  logger.substep(`WASM size: ${wasmSize}`)
  logger.logNewline()

  // Create checkpoint with smoke test.
  await createCheckpoint(
    buildDir,
    'wasm-released',
    async () => {
      // Smoke test: Verify WASM file.
      const wasmBuffer = await fs.readFile(releaseWasmFile)

      // Check WASM magic number.
      const magic = wasmBuffer.slice(0, 4).toString('hex')
      if (magic !== '0061736d') {
        throw new Error('Invalid WASM file (bad magic number)')
      }

      // Try to compile with WebAssembly API.
      const module = new WebAssembly.Module(wasmBuffer)
      const exports = WebAssembly.Module.exports(module)
      if (exports.length === 0) {
        throw new Error('WASM module has no exports')
      }
      logger.substep(`WASM valid: ${exports.length} exports`)
    },
    {
      binarySize: wasmSize,
      binaryPath: path.relative(buildDir, releaseWasmFile),
      artifactPath: outputReleaseDir,
    },
  )

  logger.success('WASM copied to Release directory')
  logger.logNewline()
}
