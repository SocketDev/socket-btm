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

// bin-infra (LIEF) has a simple checkpoint chain: just finalized.
const chain = ['finalized']

// Output as comma-separated string (for CI).
console.log(chain.join(','))
