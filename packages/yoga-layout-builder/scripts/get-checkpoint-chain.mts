#!/usr/bin/env node
/**
 * Get checkpoint chain for Yoga Layout builds.
 *
 * Usage:
 *   node scripts/get-checkpoint-chain.mts [--dev|--prod]
 *
 * Output:
 *   Comma-separated checkpoint chain in reverse dependency order.
 *
 * Prod includes wasm-optimized; dev skips it because optimization is disabled
 * in dev builds. The chain itself lives in build-infra's CHECKPOINT_CHAINS
 * registry — this script just picks the right variant and prints it.
 */
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { CHECKPOINT_CHAINS } from 'build-infra/lib/constants'

import { getDefaultLogger } from '@socketsecurity/lib/logger'

const logger = getDefaultLogger()

export function getCheckpointChain(mode) {
  return CHECKPOINT_CHAINS.yoga(mode)
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2)
  const buildMode = args.includes('--prod') ? 'prod' : 'dev'
  logger.log(getCheckpointChain(buildMode).join(','))
}
