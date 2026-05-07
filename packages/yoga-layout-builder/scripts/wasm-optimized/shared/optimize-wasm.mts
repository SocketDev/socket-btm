/**
 * WASM optimization phase for Yoga Layout
 *
 * Runs wasm-opt for production size reduction (skipped in dev mode).
 */

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getFileSize } from 'build-infra/lib/build-helpers'

import { WIN32 } from '@socketsecurity/lib/constants/platform'
import { safeDelete, safeMkdir } from '@socketsecurity/lib/fs'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

const logger = getDefaultLogger()

/**
 * Optimize WASM with wasm-opt.
 *
 * @param {object} options - Optimization options
 * @param {string} options.buildDir - Build directory
 * @param {string} options.releaseDir - Release directory (input)
 * @param {string} options.optimizedDir - Optimized directory (output)
 * @param {string} options.buildMode - Build mode ('prod' or 'dev')
 * @param {boolean} options.forceRebuild - Force rebuild (ignore checkpoints)
 */
export async function optimizeWasm(options) {
  const { buildDir, optimizedDir, releaseDir } = options

  logger.log('Running wasm-opt for additional size reduction...')
  logger.logNewline()

  await safeDelete(optimizedDir)
  await safeMkdir(optimizedDir)

  const inputWasmFile = path.join(releaseDir, 'yoga.wasm')
  const optimizedWasmFile = path.join(optimizedDir, 'yoga.wasm')
  const optimizedMjsFile = path.join(optimizedDir, 'yoga.mjs')

  // Copy MJS file (no optimization needed)
  const releaseMjsFile = path.join(releaseDir, 'yoga.mjs')
  if (existsSync(releaseMjsFile)) {
    await fs.copyFile(releaseMjsFile, optimizedMjsFile)
  }

  const sizeBeforeOpt = await getFileSize(inputWasmFile)
  logger.substep(`Size before optimization: ${sizeBeforeOpt}`)
  logger.log('Running wasm-opt...')

  // MAXIMUM AGGRESSIVE FLAGS.
  // NO BACKWARDS COMPATIBILITY - Modern runtimes only (Node.js 25+)!
  const wasmOptFlags = [
    '-Oz',
    '--enable-simd',
    // Relaxed SIMD (Node.js 22+): 5-10% performance improvement for SIMD-heavy workloads.
    '--enable-relaxed-simd',
    '--enable-bulk-memory',
    '--enable-sign-ext',
    '--enable-mutable-globals',
    '--enable-nontrapping-float-to-int',
    '--enable-reference-types',
    // Tail call optimization (Node.js 20+): 5-15% stack usage reduction.
    '--enable-tail-call',
    // Extended const expressions (Node.js 22+): 1-2% size reduction via compile-time evaluation.
    '--enable-extended-const',
    '--low-memory-unused',
    '--flatten',
    '--rereloop',
    '--vacuum',
    '--dce',
    '--remove-unused-names',
    '--remove-unused-module-elements',
    '--strip-debug',
    '--strip-dwarf',
    '--strip-producers',
    '--strip-target-features',
  ]

  // Find wasm-opt in Emscripten SDK or system PATH.
  let wasmOptCmd = 'wasm-opt'
  if (process.env.EMSDK) {
    const emsdkWasmOpt = path.join(
      process.env.EMSDK,
      'upstream',
      'bin',
      'wasm-opt',
    )
    if (existsSync(emsdkWasmOpt)) {
      wasmOptCmd = emsdkWasmOpt
      logger.substep(`Using wasm-opt from EMSDK: ${wasmOptCmd}`)
    }
  }

  const result = await spawn(
    wasmOptCmd,
    [...wasmOptFlags, inputWasmFile, '-o', optimizedWasmFile],
    {
      shell: WIN32,
      stdio: 'inherit',
    },
  )
  if (result.code !== 0) {
    throw new Error(`wasm-opt failed with exit code ${result.code}`)
  }

  const sizeAfterOpt = await getFileSize(optimizedWasmFile)
  logger.substep(`Size after optimization: ${sizeAfterOpt}`)
  logger.logNewline()

  const wasmSize = await getFileSize(optimizedWasmFile)
  return {
    artifactPath: optimizedDir,
    binaryPath: path.relative(buildDir, optimizedDir),
    binarySize: wasmSize,
    smokeTest: async () => {
      const wasmBuffer = await fs.readFile(optimizedWasmFile)
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
