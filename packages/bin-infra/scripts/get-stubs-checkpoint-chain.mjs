#!/usr/bin/env node
/**
 * Get checkpoint chain for stubs CI workflows.
 *
 * Usage:
 *   node scripts/get-stubs-checkpoint-chain.mjs [--dev|--prod]
 *
 * Output:
 *   Comma-separated checkpoint chain (e.g., "finalized")
 */

import { getCheckpointChain } from 'bin-infra/lib/build-stubs'

// Get checkpoint chain (same for dev and prod).
const chain = getCheckpointChain()

// Output as comma-separated string (for CI).
console.log(chain.join(','))
