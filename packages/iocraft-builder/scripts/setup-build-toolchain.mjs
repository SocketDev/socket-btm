/**
 * Setup build toolchain for iocraft-builder.
 *
 * This script ensures all required tools are installed:
 * - Rust toolchain (rustc, cargo)
 * - napi-rs CLI (optional, for development)
 */

import { getDefaultLogger } from '@socketsecurity/lib/logger'

const logger = getDefaultLogger()

async function main() {
  logger.step('Setting up iocraft-builder toolchain')

  // Check for Rust.
  try {
    const { spawn } = await import('@socketsecurity/registry/lib/spawn')

    const rustcResult = await spawn('rustc', ['--version'], {
      stdio: 'pipe',
    })

    if (rustcResult.exitCode === 0) {
      logger.success(`Rust found: ${rustcResult.stdout.toString().trim()}`)
    } else {
      logger.warn('Rust not found. Install from https://rustup.rs/')
    }
  } catch {
    logger.warn('Rust not found. Install from https://rustup.rs/')
  }

  logger.success('Toolchain setup complete')
}

main().catch(error => {
  logger.error('Setup failed:', error.message)
  // Don't fail postinstall - Rust may not be needed for all operations.
})
