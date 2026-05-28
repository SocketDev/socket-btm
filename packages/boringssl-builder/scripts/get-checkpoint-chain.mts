#!/usr/bin/env node
/**
 * Get checkpoint chain for boringssl-builder CI workflows.
 *
 * Runs BEFORE `pnpm install` has populated node_modules in the CI
 * install step. Uses only `node:` built-ins — no npm imports — so a
 * pnpm-install hiccup can't block the workflow at its earliest step.
 * Mirrors lief-builder/scripts/get-checkpoint-chain.mts.
 *
 * Source of truth for the chain lives in
 * packages/build-infra/lib/constants.mts (`CHECKPOINT_CHAINS.boringssl`
 * once registered there). BoringSSL has a single checkpoint: the build
 * does not emit a separate FINALIZED stage — `boringssl-built` IS the
 * final output.
 */

import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const CHAIN = ['boringssl-built']

export function getCheckpointChain() {
  return CHAIN
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1]!)) {
  process.stdout.write(`${CHAIN.join(',')}\n`)
}
