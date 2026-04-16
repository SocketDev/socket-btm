#!/usr/bin/env node
/**
 * Get checkpoint chain for node-smol builds.
 *
 * Zero external dependencies — safe to run before pnpm install.
 *
 * Usage:
 *   node scripts/get-checkpoint-chain.mts
 *
 * Output:
 *   Comma-separated checkpoint chain in reverse dependency order.
 */
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

// Node-smol checkpoint chain (same for dev and prod).
const CHECKPOINT_CHAIN = [
  'finalized',
  'binary-compressed',
  'binary-stripped',
  'binary-released',
  'source-patched',
  'source-copied',
]

export function getCheckpointChain() {
  return CHECKPOINT_CHAIN
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  console.log(CHECKPOINT_CHAIN.join(','))
}
