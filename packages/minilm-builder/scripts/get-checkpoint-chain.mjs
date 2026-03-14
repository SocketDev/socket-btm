#!/usr/bin/env node
/**
 * Get checkpoint chain for MiniLM model builds.
 *
 * Usage:
 *   node scripts/get-checkpoint-chain.mjs [--dev|--prod]
 *
 * Output:
 *   Comma-separated checkpoint chain in reverse dependency order
 *   (finalized depends on optimized, optimized depends on quantized, etc.)
 *
 * Example output:
 *   finalized,optimized,quantized,converted,downloaded
 *
 * Note: Unlike WASM builds, model checkpoints are the same for dev and prod.
 *       The difference is only in quantization level (INT8 vs INT4).
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
export function getCheckpointChain(_mode) {
  return CHECKPOINT_CHAINS.model()
}

// When run as script, output chain for use in CI.
if (import.meta.url === `file://${process.argv[1]}`) {
  const chain = getCheckpointChain(buildMode)
  validateCheckpointChain(chain, 'minilm-builder')
  logger.log(chain.join(','))
}
