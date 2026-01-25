/**
 * WASM sync wrapper generation phase for Yoga Layout.
 *
 * Generates synchronous wrapper for WASM module.
 */

import { generateSync as generateSyncShared } from 'build-infra/wasm-synced/generate-sync-phase'

/**
 * Generate synchronous wrapper for Yoga Layout WASM.
 *
 * @param {object} options - Sync generation options (see generate-sync-phase.mjs)
 */
export async function generateSync(options) {
  return generateSyncShared({
    ...options,
    packageConfig: {
      description:
        'Built with aggressive size optimizations for synchronous instantiation.',
      expectedExports: buildMode => (buildMode === 'prod' ? 8 : 11),
      exportName: 'yoga',
      initFunctionName: 'Module',
      packageName: 'yoga-layout',
    },
  })
}
