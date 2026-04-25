/**
 * Postinstall toolchain check for napi-go.
 *
 * Reports whether Go is on PATH. Does not attempt auto-install — Go is
 * currently a system dependency (see external-tools.json). A missing
 * toolchain is a warning, not an install-time failure, to match the
 * pattern used by iocraft-builder (Rust via rustup).
 */

import { WIN32 } from '@socketsecurity/lib/constants/platform'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

const logger = getDefaultLogger()

async function main() {
  logger.step('Setting up napi-go toolchain')

  try {
    const result = await spawn('go', ['version'], {
      shell: WIN32,
      stdio: 'pipe',
    })
    const exit = result.code ?? result.exitCode ?? 0
    if (exit === 0) {
      logger.success(`Go found: ${result.stdout.toString().trim()}`)
    } else {
      logger.warn('Go not found. Install from https://go.dev/dl/')
    }
  } catch {
    logger.warn('Go not found. Install from https://go.dev/dl/')
  }

  logger.success('Toolchain setup complete')
}

main().catch(() => {
  // Don't fail postinstall — Go may not be needed for all operations.
})
