#!/usr/bin/env node
/**
 * Get checkpoint chain for lief-builder CI workflows.
 *
 * Runs BEFORE `pnpm install` has populated node_modules in the CI
 * install step (observed failure: Socket Firewall wrapper emitting
 * "did not detect any package fetch attempts" on fresh macOS runners,
 * leaving `node_modules/build-infra` unlinked). This script must
 * therefore use only `node:` built-ins — no npm imports — so a
 * pnpm-install hiccup can't block the workflow at its earliest step.
 *
 * Source of truth for the chain lives in
 * packages/build-infra/lib/constants.mts (`CHECKPOINT_CHAINS.lief`).
 * LIEF has a single checkpoint: the build does not emit a separate
 * FINALIZED stage — `lief-built` IS the final output.
 */

import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const CHAIN = ['lief-built']

export function getCheckpointChain() {
  return CHAIN
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  process.stdout.write(`${CHAIN.join(',')}\n`)
}
