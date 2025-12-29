#!/usr/bin/env node
/**
 * Get checkpoint chain for ONNX Runtime builds.
 *
 * Usage:
 *   node scripts/get-checkpoint-chain.mjs [--dev|--prod]
 *
 * Output:
 *   Comma-separated checkpoint chain in reverse dependency order
 *   (finalized depends on wasm-synced, wasm-synced depends on wasm-optimized, etc.)
 *
 * Example output (prod):
 *   finalized,wasm-synced,wasm-optimized,wasm-released,wasm-compiled,source-cloned
 *
 * Example output (dev):
 *   finalized,wasm-synced,wasm-released,wasm-compiled,source-cloned
 *
 * Note: Dev mode skips wasm-optimized checkpoint (optimization is disabled in dev builds)
 */

// Parse command line args
const args = process.argv.slice(2)
const buildMode = args.includes('--prod') ? 'prod' : 'dev'

// Get checkpoint chain based on build mode
export function getCheckpointChain(mode) {
  if (mode === 'prod') {
    // Production: includes wasm-optimized for size optimization
    return [
      'finalized',
      'wasm-synced',
      'wasm-optimized',
      'wasm-released',
      'wasm-compiled',
      'source-cloned',
    ]
  }
  // Development: skips wasm-optimized (faster builds, larger files)
  return [
    'finalized',
    'wasm-synced',
    'wasm-released',
    'wasm-compiled',
    'source-cloned',
  ]
}

// When run as script, output chain for use in CI
if (import.meta.url === `file://${process.argv[1]}`) {
  const chain = getCheckpointChain(buildMode)
  console.log(chain.join(','))
}
