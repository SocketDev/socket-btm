/**
 * WASM release phase for Yoga Layout
 *
 * Copies WASM from build to Release directory.
 */

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'

import { getFileSize } from 'build-infra/lib/build-helpers'
import { printError } from 'build-infra/lib/build-output'

import { safeDelete, safeMkdir } from '@socketsecurity/lib/fs'
import { getDefaultLogger } from '@socketsecurity/lib/logger'

const logger = getDefaultLogger()

/**
 * Copy WASM from build to Release directory. Returns checkpoint metadata.
 *
 * @param {object} options
 * @param {string} options.buildDir
 * @param {string} options.outputReleaseDir
 * @param {string} options.buildWasmFile
 * @param {string} options.buildJsFile
 */
export async function copyToRelease(options) {
  const { buildDir, buildJsFile, buildWasmFile, outputReleaseDir } = options

  logger.log('Copying WASM artifacts from cmake build to out/Release...')
  logger.logNewline()

  await safeDelete(outputReleaseDir)
  await safeMkdir(outputReleaseDir)

  if (!existsSync(buildWasmFile)) {
    printError('WASM file not found - build failed')
    throw new Error(`Required WASM file not found: ${buildWasmFile}`)
  }

  const releaseWasmFile = path.join(outputReleaseDir, 'yoga.wasm')
  await fs.copyFile(buildWasmFile, releaseWasmFile)

  const releaseMjsFile = path.join(outputReleaseDir, 'yoga.mjs')
  if (existsSync(buildJsFile)) {
    await fs.copyFile(buildJsFile, releaseMjsFile)
    logger.substep(`MJS: ${releaseMjsFile}`)
  }

  const wasmSize = await getFileSize(releaseWasmFile)
  logger.substep(`WASM: ${releaseWasmFile}`)
  logger.substep(`WASM size: ${wasmSize}`)
  logger.logNewline()

  return {
    artifactPath: outputReleaseDir,
    binaryPath: path.relative(buildDir, outputReleaseDir),
    binarySize: wasmSize,
    smokeTest: async () => {
      const wasmBuffer = await fs.readFile(releaseWasmFile)
      const magic = wasmBuffer.slice(0, 4).toString('hex')
      if (magic !== '0061736d') {
        throw new Error('Invalid WASM file (bad magic number)')
      }
      const module = new WebAssembly.Module(wasmBuffer)
      const exports = WebAssembly.Module.exports(module)
      if (exports.length === 0) {
        throw new Error('WASM module has no exports')
      }
    },
  }
}
