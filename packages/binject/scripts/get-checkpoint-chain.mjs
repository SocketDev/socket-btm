#!/usr/bin/env node
/**
 * Get checkpoint chain for CI workflows.
 *
 * Usage:
 *   node scripts/get-checkpoint-chain.mjs [--dev|--prod]
 *
 * Output:
 *   Comma-separated checkpoint chain (e.g., "finalized,lief-built")
 */

// binject has two checkpoints: finalized and lief-built (macOS only)
const chain = ['finalized', 'lief-built']

// Output as comma-separated string (for CI)
console.log(chain.join(','))
