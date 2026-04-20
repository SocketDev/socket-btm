/**
 * Setup build toolchain for opentui-builder.
 *
 * This script ensures Zig is available.
 */

import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

import { errorMessage } from 'build-infra/lib/error-utils'

const logger = getDefaultLogger()

async function main() {
  logger.step('Setting up opentui-builder toolchain')

  try {
    const result = await spawn('zig', ['version'], {
      stdio: 'pipe',
    })

    if (result.exitCode === 0) {
      logger.success(`Zig found: ${result.stdout.toString().trim()}`)
    } else {
      logger.warn('Zig not found. Install from https://ziglang.org/download/')
    }
  } catch {
    logger.warn('Zig not found. Install from https://ziglang.org/download/')
  }

  logger.success('Toolchain setup complete')
}

main().catch(error => {
  logger.error('Setup failed:', errorMessage(error))
  // Don't fail postinstall - Zig may not be needed for all operations.
})
