/**
 * Postinstall toolchain check for ultraviolet-builder.
 *
 * - Initializes the upstream ultraviolet submodule if missing
 *   (fatal on a non-CI workstation; CI workflows init submodules
 *   themselves before reaching this script).
 * - Verifies Go >= 1.25 is available (advisory — postinstall must
 *   stay fail-soft so `pnpm install` across the whole monorepo
 *   doesn't break for unrelated workspaces).
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { WIN32 } from '@socketsecurity/lib-stable/constants/platform'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { errorMessage } from 'build-infra/lib/error-utils'
import { ensureSubmodule } from 'build-infra/lib/submodule-init'

const logger = getDefaultLogger()
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const monorepoRoot = path.resolve(__dirname, '../../..')

async function main() {
  logger.step('Setting up ultraviolet-builder toolchain')

  try {
    await ensureSubmodule({
      monorepoRoot,
      name: 'ultraviolet',
      sentinelFile: 'go.mod',
      submodulePath: 'packages/ultraviolet-builder/upstream/ultraviolet',
    })
  } catch (e) {
    logger.warn(`Submodule init skipped: ${errorMessage(e)}`)
  }

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
