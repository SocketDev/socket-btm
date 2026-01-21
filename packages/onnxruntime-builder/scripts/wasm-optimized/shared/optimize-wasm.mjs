/**
 * WASM optimization phase for ONNX Runtime
 *
 * Runs wasm-opt for production size reduction (skipped in dev mode).
 */

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'

import { getFileSize } from 'build-infra/lib/build-helpers'
import { createCheckpoint, shouldRun } from 'build-infra/lib/checkpoint-manager'
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

  // Clean Optimized directory before copying to ensure only intended files are archived
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

    // Run wasm-opt with aggressive optimization for ONNX Runtime (with threading)
    await spawn(
      'wasm-opt',
      [
        '-Oz',
        '--enable-threads',
        '--enable-simd',
        inputWasmFile,
        '-o',
        optimizedWasmFile,
      ],
      { shell: WIN32, stdio: 'inherit' },
    )

    const sizeAfterOpt = await getFileSize(optimizedWasmFile)
    logger.substep(`Size after optimization: ${sizeAfterOpt}`)
    logger.logNewline()
  }

  // Create checkpoint with smoke test.
  const wasmSize = await getFileSize(optimizedWasmFile)
  await createCheckpoint(
    buildDir,
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
      artifactPath: optimizedDir,
    },
  )

  logger.success('WASM optimization complete')
  logger.logNewline()
}
