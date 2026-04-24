/**
 * Postinstall toolchain check for ultraviolet-builder.
 *
 * Ultraviolet requires Go >= 1.25 per its go.mod; warn, don't fail,
 * so `pnpm install` across the monorepo stays resilient when this
 * package isn't actively being built.
 */

import { WIN32 } from '@socketsecurity/lib/constants/platform'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

const logger = getDefaultLogger()

async function main() {
  logger.step('Setting up ultraviolet-builder toolchain')

  try {
    const result = await spawn('go', ['version'], {
      shell: WIN32,
      stdio: 'pipe',
    })
    const exit = result.code ?? result.exitCode ?? 0
    if (exit === 0) {
      logger.success(`Go found: ${result.stdout.toString().trim()}`)
    } else {
      logger.warn(
        'Go not found. Install Go >= 1.25 from https://go.dev/dl/ before building.',
      )
    }
  } catch {
    logger.warn(
      'Go not found. Install Go >= 1.25 from https://go.dev/dl/ before building.',
    )
  }

  logger.success('Toolchain setup complete')
}

main().catch(() => {
  // Don't fail postinstall — the check is advisory.
})
