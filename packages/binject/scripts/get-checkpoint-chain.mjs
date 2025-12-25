#!/usr/bin/env node
/**
 * Get checkpoint chain for CI workflows.
 *
 * Usage:
 *   node scripts/get-checkpoint-chain.mjs [--dev|--prod]
 *
 * Output:
 *   Comma-separated checkpoint chain (e.g., "finalized")
 */

// binject has one checkpoint: finalized (LIEF is downloaded, not built)
const chain = ['finalized']

// Output as comma-separated string (for CI)
console.log(chain.join(','))
