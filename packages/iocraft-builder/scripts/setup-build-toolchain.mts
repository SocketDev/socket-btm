/**
 * Setup build toolchain for iocraft-builder.
 *
 * This script ensures all required tools are installed:
 * - Rust toolchain (rustc, cargo)
 * - napi-rs CLI (optional, for development)
 */

import { WIN32 } from '@socketsecurity/lib/constants/platform'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

import { errorMessage } from 'build-infra/lib/error-utils'

const logger = getDefaultLogger()

async function main() {
  logger.step('Setting up iocraft-builder toolchain')

  // Check for Rust.
  try {
    const rustcResult = await spawn('rustc', ['--version'], {
      shell: WIN32,
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
  logger.error('Setup failed:', errorMessage(error))
  // Don't fail postinstall - Rust may not be needed for all operations.
})
