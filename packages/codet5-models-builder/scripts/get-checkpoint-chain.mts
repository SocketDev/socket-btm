#!/usr/bin/env node
/**
 * Get checkpoint chain for CodeT5 model builds.
 *
 * Usage:
 *   node scripts/get-checkpoint-chain.mts
 *
 * Output:
 *   Comma-separated checkpoint chain in reverse dependency order.
 *   (finalized depends on optimized, optimized depends on quantized, etc.)
 *
 * Model checkpoints are the same for dev and prod — the difference is
 * only in quantization level (INT8 vs INT4).
 *
 * Runs before `pnpm install` has linked node_modules in the CI
 * install step, so this script uses only `node:` built-ins. Source
 * of truth for the chain lives in packages/build-infra/lib/
 * constants.mts (`CHECKPOINT_CHAINS.model`) — keep in sync.
 */
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const CHAIN = [
  'finalized',
  'optimized',
  'quantized',
  'converted',
  'downloaded',
]

export function getCheckpointChain() {
  return CHAIN
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  process.stdout.write(`${CHAIN.join(',')}\n`)
}
