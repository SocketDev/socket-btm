/**
 * Get checkpoint chain for curl CI workflows.
 *
 * Usage:
 *   node scripts/get-checkpoint-chain.mjs [--dev|--prod]
 *
 * Output:
 *   Comma-separated checkpoint chain (e.g., "finalized,mbedtls")
 */

import { getCheckpointChain } from './build.mjs'

// Get checkpoint chain (same for dev and prod).
const chain = getCheckpointChain()

// Output as comma-separated string (for CI).
console.log(chain.join(','))
