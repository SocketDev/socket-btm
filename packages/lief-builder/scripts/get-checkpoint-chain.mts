#!/usr/bin/env node
/**
 * Get checkpoint chain for lief-builder CI workflows.
 *
 * LIEF has only one checkpoint (`lief-built`) — no separate finalized stage.
 * This chain must stay in sync with the checkpoint name in build.mts.
 */

import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { CHECKPOINT_CHAINS } from 'build-infra/lib/constants'

import { getDefaultLogger } from '@socketsecurity/lib/logger'

const logger = getDefaultLogger()

export function getCheckpointChain() {
  return CHECKPOINT_CHAINS.lief()
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  logger.log(getCheckpointChain().join(','))
}
