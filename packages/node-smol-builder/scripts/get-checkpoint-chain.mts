#!/usr/bin/env node
/**
 * Get checkpoint chain for node-smol builds.
 *
 * Usage:
 *   node scripts/get-checkpoint-chain.mts
 *
 * Output:
 *   Comma-separated checkpoint chain in reverse dependency order.
 *
 * Runs before `pnpm install` has linked node_modules in the CI
 * install step, so this script uses only `node:` built-ins. Source
 * of truth for the chain lives in packages/build-infra/lib/
 * constants.mts (`CHECKPOINT_CHAINS.nodeSmol`) — keep in sync.
 */
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const CHAIN = [
  'finalized',
  'binary-compressed',
  'binary-stripped',
  'binary-released',
  'source-patched',
  'source-copied',
]

export function getCheckpointChain() {
  return CHAIN
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  process.stdout.write(`${CHAIN.join(',')}\n`)
}
