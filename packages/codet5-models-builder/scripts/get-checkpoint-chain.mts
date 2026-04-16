#!/usr/bin/env node
/**
 * Get checkpoint chain for CodeT5 model builds.
 *
 * Zero external dependencies — safe to run before pnpm install.
 *
 * Usage:
 *   node scripts/get-checkpoint-chain.mts
 *
 * Output:
 *   Comma-separated checkpoint chain in reverse dependency order.
 *   (finalized depends on optimized, optimized depends on quantized, etc.)
 *
 * Note: Unlike WASM builds, model checkpoints are the same for dev and prod.
 *       The difference is only in quantization level (INT8 vs INT4).
 */
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

// Full model pipeline (with optimization step).
const CHECKPOINT_CHAIN = [
  'finalized',
  'optimized',
  'quantized',
  'converted',
  'downloaded',
]

export function getCheckpointChain() {
  return CHECKPOINT_CHAIN
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  console.log(CHECKPOINT_CHAIN.join(','))
}
