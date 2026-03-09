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
 *   finalized,wasm-synced,wasm-optimized,wasm-released,wasm-compiled
 *
 * Example output (dev):
 *   finalized,wasm-synced,wasm-released,wasm-compiled
 *
 * Note: Dev mode skips wasm-optimized checkpoint (optimization is disabled in dev builds)
 */

import {
  CHECKPOINT_CHAINS,
  validateCheckpointChain,
} from 'build-infra/lib/constants'

import { getDefaultLogger } from '@socketsecurity/lib/logger'

const logger = getDefaultLogger()

// Parse command line args.
const args = process.argv.slice(2)
const buildMode = args.includes('--prod') ? 'prod' : 'dev'

// Get checkpoint chain from centralized registry.
export function getCheckpointChain(mode) {
  return CHECKPOINT_CHAINS.onnxruntime(mode)
}

// When run as script, output chain for use in CI.
if (import.meta.url === `file://${process.argv[1]}`) {
  const chain = getCheckpointChain(buildMode)
  validateCheckpointChain(chain, 'onnxruntime-builder')
  logger.log(chain.join(','))
}
