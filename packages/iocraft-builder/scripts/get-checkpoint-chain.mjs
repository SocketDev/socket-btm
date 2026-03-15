#!/usr/bin/env node
/**
 * Get checkpoint chain for iocraft builds.
 *
 * Usage:
 *   node scripts/get-checkpoint-chain.mjs [--dev|--prod]
 *
 * Output:
 *   Comma-separated checkpoint chain in reverse dependency order
 *
 * Example output:
 *   finalized,native-built,source-configured
 */

import { getDefaultLogger } from '@socketsecurity/lib/logger'

const logger = getDefaultLogger()

// Parse command line args.
const args = process.argv.slice(2)
const buildMode = args.includes('--prod') ? 'prod' : 'dev'

/**
 * Get checkpoint chain for iocraft builds.
 * Simpler than yoga-layout since we're just compiling Rust.
 */
export function getCheckpointChain(mode) {
  // For iocraft, the checkpoint chain is simpler:
  // 1. source-configured - Upstream submodule checked out
  // 2. native-built - Cargo build complete
  // 3. finalized - Output copied to final location
  return ['finalized', 'native-built', 'source-configured']
}

// When run as script, output chain for use in CI.
if (import.meta.url === `file://${process.argv[1]}`) {
  const chain = getCheckpointChain(buildMode)
  logger.log(chain.join(','))
}
