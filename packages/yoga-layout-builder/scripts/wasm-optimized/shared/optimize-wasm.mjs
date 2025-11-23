/**
 * WASM optimization phase for Yoga Layout
 *
 * Runs wasm-opt for production size reduction (skipped in dev mode).
 */

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'

import { getFileSize } from 'build-infra/lib/build-helpers'
import { createCheckpoint, shouldRun } from 'build-infra/lib/checkpoint-manager'

import { WIN32 } from '@socketsecurity/lib/constants/platform'
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
  const { buildDir, buildMode, forceRebuild, optimizedDir, releaseDir } =
    options

  // Skip optimization for dev builds
  if (buildMode !== 'prod') {
    logger.skip('Skipping WASM optimization (dev mode)')
    logger.logNewline()
    return
  }

  if (!(await shouldRun(buildDir, '', 'wasm-optimized', forceRebuild))) {
    return
  }

  logger.step('Optimizing WASM (Production)')
  logger.log('Running wasm-opt for additional size reduction...')
  logger.logNewline()

  await fs.mkdir(optimizedDir, { recursive: true })

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
  // NO BACKWARDS COMPATIBILITY - Modern runtimes only!
  const wasmOptFlags = [
    '-Oz',
    '--enable-simd',
    '--enable-bulk-memory',
    '--enable-sign-ext',
    '--enable-mutable-globals',
    '--enable-nontrapping-float-to-int',
    '--enable-reference-types',
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

  // Create checkpoint with smoke test.
  const wasmSize = await getFileSize(optimizedWasmFile)
  await createCheckpoint(
    buildDir,
    '',
    'wasm-optimized',
    async () => {
      // Smoke test: Verify optimized WASM is valid.
      const wasmBuffer = await fs.readFile(optimizedWasmFile)

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
      logger.substep(`Optimized WASM valid: ${exports.length} exports`)
    },
    {
      binarySize: wasmSize,
      binaryPath: path.relative(buildDir, optimizedWasmFile),
      artifactPath: optimizedWasmFile,
    },
  )

  logger.success('WASM optimization complete')
  logger.logNewline()
}
