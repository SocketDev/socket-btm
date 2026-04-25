/**
 * WASM optimization phase for ONNX Runtime
 *
 * Runs wasm-opt for production size reduction (skipped in dev mode).
 */

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'

import { getFileSize } from 'build-infra/lib/build-helpers'
import { ensureToolInstalled } from 'build-infra/lib/tool-installer'

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

  const inputWasmFile = path.join(releaseDir, 'ort.wasm')
  const optimizedWasmFile = path.join(optimizedDir, 'ort.wasm')
  const optimizedMjsFile = path.join(optimizedDir, 'ort.mjs')

  // Copy MJS file (no optimization needed)
  const releaseMjsFile = path.join(releaseDir, 'ort.mjs')
  if (existsSync(releaseMjsFile)) {
    await fs.copyFile(releaseMjsFile, optimizedMjsFile)
  }

  // Check if wasm-opt is available
  const wasmOptResult = await ensureToolInstalled('wasm-opt', {
    autoInstall: false,
  })

  if (!wasmOptResult.available) {
    logger.warn('wasm-opt not available - copying without optimization')
    await fs.copyFile(inputWasmFile, optimizedWasmFile)
  } else {
    const sizeBeforeOpt = await getFileSize(inputWasmFile)
    logger.substep(`Size before optimization: ${sizeBeforeOpt}`)
    logger.log('Running wasm-opt...')

    // Run wasm-opt with optimization for ONNX Runtime (with threading).
    // Note: --flatten and --rereloop are omitted because --flatten can create functions
    // with too many locals in large WASM files (causing "local count too large" errors),
    // and --rereloop requires --flatten to work.
    const wasmOptFlags = [
      '-Oz',
      '--enable-threads',
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
      '--vacuum',
      '--dce',
      '--remove-unused-names',
      '--remove-unused-module-elements',
      '--strip-debug',
      '--strip-dwarf',
      '--strip-producers',
      '--strip-target-features',
    ]

    await spawn(
      'wasm-opt',
      [...wasmOptFlags, inputWasmFile, '-o', optimizedWasmFile],
      { shell: WIN32, stdio: 'inherit' },
    )

    const sizeAfterOpt = await getFileSize(optimizedWasmFile)
    logger.substep(`Size after optimization: ${sizeAfterOpt}`)
    logger.logNewline()
  }

  const wasmSize = await getFileSize(optimizedWasmFile)
  return {
    artifactPath: optimizedDir,
    binaryPath: path.relative(buildDir, optimizedWasmFile),
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
