#!/usr/bin/env node
/**
 * Get checkpoint chain for CI workflows.
 *
 * Shared script used by all packages with simple checkpoint chains.
 *
 * Usage:
 *   node scripts/get-checkpoint-chain.mjs [--dev|--prod]
 *
 * Output:
 *   Comma-separated checkpoint chain (e.g., "finalized")
 */

import { getSimpleCheckpointChain } from 'build-infra/lib/get-simple-checkpoint-chain'

console.log(getSimpleCheckpointChain())
