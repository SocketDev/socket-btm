/**
 * WASM sync wrapper generation phase for ONNX Runtime.
 *
 * Generates synchronous wrapper for WASM module.
 */

import { generateSync as generateSyncShared } from 'build-infra/wasm-synced/generate-sync-phase'

/**
 * Generate synchronous wrapper for ONNX Runtime WASM.
 *
 * @param {object} options - Sync generation options (see generate-sync-phase.mts)
 */
export async function generateSync(options) {
  return generateSyncShared({
    ...options,
    packageConfig: {
      description:
        'Built with WASM threading + SIMD for synchronous instantiation.',
      // ONNX Runtime's WASM output stabilized at 45 exports for our
      // current build config (threading + SIMD, minimal-build operator
      // set, disable_rtti). Bump when upstream adds/removes ORT_ APIs
      // we surface. Previous value was 50 for an older ONNX Runtime.
      expectedExports: 45,
      exportName: 'ort',
      fileBaseName: 'ort',
      initFunctionName: 'ortWasmThreaded',
      packageName: 'onnxruntime',
    },
  })
}
