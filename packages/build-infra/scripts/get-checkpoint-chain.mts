#!/usr/bin/env node
/**
 * Get checkpoint chain for CI workflows.
 *
 * Shared script used by all packages with simple checkpoint chains
 * (binsuite packages: binpress, binflate, binject, stubs, libpq, lief).
 *
 * Usage:
 *   node scripts/get-checkpoint-chain.mts
 *
 * Output:
 *   Comma-separated checkpoint chain (e.g., "finalized") — the comma separator
 *   is load-bearing: CI workflows capture this with $(node ...) and split on ',' .
 */
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { CHECKPOINT_CHAINS } from '../lib/constants.mts'

import { getDefaultLogger } from '@socketsecurity/lib/logger'

const logger = getDefaultLogger()

export function getCheckpointChain() {
  return CHECKPOINT_CHAINS.simple()
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  logger.log(getCheckpointChain().join(','))
}
