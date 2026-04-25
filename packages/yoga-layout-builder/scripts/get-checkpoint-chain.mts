#!/usr/bin/env node
/**
 * Get checkpoint chain for Yoga Layout builds.
 *
 * Usage:
 *   node scripts/get-checkpoint-chain.mts [--dev|--prod]
 *
 * Output:
 *   Comma-separated checkpoint chain in reverse dependency order.
 *
 * Prod includes wasm-optimized; dev skips it because optimization is
 * disabled in dev builds.
 *
 * Runs before `pnpm install` has linked node_modules in the CI
 * install step, so this script uses only `node:` built-ins. Source
 * of truth for the chain lives in packages/build-infra/lib/
 * constants.mts (`CHECKPOINT_CHAINS.yoga`) — keep in sync.
 */
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const CHAIN_PROD = [
  'finalized',
  'wasm-synced',
  'wasm-optimized',
  'wasm-released',
  'wasm-compiled',
  'source-configured',
  'source-cloned',
]

const CHAIN_DEV = [
  'finalized',
  'wasm-synced',
  'wasm-released',
  'wasm-compiled',
  'source-configured',
  'source-cloned',
]

export function getCheckpointChain(mode) {
  return mode === 'prod' ? CHAIN_PROD : CHAIN_DEV
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2)
  const buildMode = args.includes('--prod') ? 'prod' : 'dev'
  process.stdout.write(`${getCheckpointChain(buildMode).join(',')}\n`)
}
