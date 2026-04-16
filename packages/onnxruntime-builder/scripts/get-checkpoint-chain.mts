#!/usr/bin/env node
/**
 * Get checkpoint chain for ONNX Runtime builds.
 *
 * Zero external dependencies — safe to run before pnpm install.
 *
 * Usage:
 *   node scripts/get-checkpoint-chain.mts [--dev|--prod]
 *
 * Output:
 *   Comma-separated checkpoint chain in reverse dependency order.
 *
 * Example output (prod):
 *   finalized,wasm-synced,wasm-optimized,wasm-released,wasm-compiled
 *
 * Example output (dev):
 *   finalized,wasm-synced,wasm-released,wasm-compiled
 *
 * Note: Dev mode skips wasm-optimized checkpoint (optimization is disabled in dev builds).
 */
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

// Prod: includes wasm-optimized.
const CHECKPOINT_CHAIN_PROD = [
  'finalized',
  'wasm-synced',
  'wasm-optimized',
  'wasm-released',
  'wasm-compiled',
]

// Dev: skips wasm-optimized for faster builds.
const CHECKPOINT_CHAIN_DEV = [
  'finalized',
  'wasm-synced',
  'wasm-released',
  'wasm-compiled',
]

export function getCheckpointChain(mode) {
  return mode === 'prod' ? CHECKPOINT_CHAIN_PROD : CHECKPOINT_CHAIN_DEV
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2)
  const buildMode = args.includes('--prod') ? 'prod' : 'dev'
  console.log(getCheckpointChain(buildMode).join(','))
}
