#!/usr/bin/env node
/**
 * Get checkpoint chain for CI workflows.
 *
 * Usage:
 *   node scripts/get-checkpoint-chain.mjs [--dev|--prod]
 *
 * Output:
 *   Comma-separated checkpoint chain (e.g., "finalized,binary-compressed,...")
 */

import { getCheckpointChain } from './binary-released/shared/build-released.mjs'

// Parse command line args
const args = process.argv.slice(2)
const buildMode = args.includes('--prod') ? 'prod' : 'dev'

// Get checkpoint chain
const chain = getCheckpointChain(buildMode)

// Output as comma-separated string (for CI)
console.log(chain.join(','))
