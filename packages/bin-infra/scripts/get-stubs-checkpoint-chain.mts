#!/usr/bin/env node
/**
 * Get checkpoint chain for stubs CI workflows.
 *
 * Usage:
 *   node scripts/get-stubs-checkpoint-chain.mts [--dev|--prod]
 *
 * Output:
 *   Comma-separated checkpoint chain (e.g., "finalized")
 */

import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { getCheckpointChain } from 'bin-infra/lib/build-stubs'

const logger = getDefaultLogger()

// Get checkpoint chain (same for dev and prod).
const chain = getCheckpointChain()

// Output as comma-separated string (for CI).
logger.log(chain.join(','))
