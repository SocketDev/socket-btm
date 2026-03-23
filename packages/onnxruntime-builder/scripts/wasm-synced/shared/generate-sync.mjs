/**
 * WASM sync wrapper generation phase for ONNX Runtime.
 *
 * Generates synchronous wrapper for WASM module.
 */

import { generateSync as generateSyncShared } from 'build-infra/wasm-synced/generate-sync-phase'

/**
 * Generate synchronous wrapper for ONNX Runtime WASM.
 *
 * @param {object} options - Sync generation options (see generate-sync-phase.mjs)
 */
export async function generateSync(options) {
  return generateSyncShared({
    ...options,
    packageConfig: {
      description:
        'Built with WASM threading + SIMD for synchronous instantiation.',
      expectedExports: 50,
      exportName: 'ort',
      fileBaseName: 'ort',
      initFunctionName: 'ortWasmThreaded',
      packageName: 'onnxruntime',
    },
  })
}
