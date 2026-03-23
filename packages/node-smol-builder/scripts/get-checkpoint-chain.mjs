#!/usr/bin/env node
/**
 * Get checkpoint chain for node-smol builds.
 *
 * Usage:
 *   node scripts/get-checkpoint-chain.mjs [--dev|--prod]
 *
 * Output:
 *   Comma-separated checkpoint chain in reverse dependency order
 *   (finalized depends on binary-compressed, binary-compressed depends on binary-stripped, etc.)
 *
 * Example output:
 *   finalized,binary-compressed,binary-stripped,binary-released,source-patched,source-cloned
 *
 * Note: Node-smol checkpoints are the same for dev and prod.
 */
import process from 'node:process'

import {
  CHECKPOINT_CHAINS,
  validateCheckpointChain,
} from 'build-infra/lib/constants'

import { getDefaultLogger } from '@socketsecurity/lib/logger'

const logger = getDefaultLogger()

// Get checkpoint chain from centralized registry.
// Note: Node-smol checkpoints are the same for dev and prod.
export function getCheckpointChain() {
  return CHECKPOINT_CHAINS.nodeSmol()
}

// When run as script, output chain for use in CI.
if (import.meta.url === `file://${process.argv[1]}`) {
  const chain = getCheckpointChain()
  validateCheckpointChain(chain, 'node-smol-builder')
  logger.log(chain.join(','))
}
