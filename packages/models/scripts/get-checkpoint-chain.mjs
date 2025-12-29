#!/usr/bin/env node
/**
 * Get checkpoint chain for model builds.
 *
 * Usage:
 *   node scripts/get-checkpoint-chain.mjs [--dev|--prod]
 *
 * Output:
 *   Comma-separated checkpoint chain in reverse dependency order
 *   (finalized depends on quantized, quantized depends on converted, etc.)
 *
 * Example output:
 *   finalized,quantized,converted,downloaded
 *
 * Note: Unlike WASM builds, model checkpoints are the same for dev and prod.
 *       The difference is only in quantization level (INT8 vs INT4).
 */

// Parse command line args
const args = process.argv.slice(2)
const buildMode = args.includes('--prod') ? 'prod' : 'dev'

// Get checkpoint chain based on build mode
export function getCheckpointChain(_mode) {
  // Same checkpoint chain for both dev and prod
  // (quantization level is parameter, not separate checkpoint)
  return ['finalized', 'quantized', 'converted', 'downloaded']
}

// When run as script, output chain for use in CI
if (import.meta.url === `file://${process.argv[1]}`) {
  const chain = getCheckpointChain(buildMode)
  console.log(chain.join(','))
}
