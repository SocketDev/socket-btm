#!/usr/bin/env node
/**
 * Get checkpoint chain for node-smol builds.
 *
 * Usage:
 *   node scripts/get-checkpoint-chain.mts
 *
 * Output:
 *   Comma-separated checkpoint chain in reverse dependency order.
 *
 * The chain itself lives in build-infra's CHECKPOINT_CHAINS registry.
 */
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { CHECKPOINT_CHAINS } from 'build-infra/lib/constants'

import { getDefaultLogger } from '@socketsecurity/lib/logger'

const logger = getDefaultLogger()

export function getCheckpointChain() {
  return CHECKPOINT_CHAINS.nodeSmol()
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  logger.log(getCheckpointChain().join(','))
}
