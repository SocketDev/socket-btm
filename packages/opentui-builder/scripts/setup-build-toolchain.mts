/**
 * Setup build toolchain for opentui-builder.
 *
 * Ensures Zig 0.15.2 (the version pinned in external-tools.json) is
 * available, auto-downloading + caching to the shared tool cache when
 * the system binary is missing or the wrong version. Mirrors the
 * ensureZig() flow in build.mts so `pnpm run setup` produces a
 * build-ready environment without depending on a system Zig install.
 */

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { errorMessage } from 'build-infra/lib/error-utils'
import { ensureToolInstalled } from 'build-infra/lib/tool-installer'

import { PACKAGE_ROOT } from './paths.mts'

const logger = getDefaultLogger()

async function main() {
  logger.step('Setting up opentui-builder toolchain')

  const result = await ensureToolInstalled('zig', {
    autoInstall: true,
    toolOptions: { packageRoot: PACKAGE_ROOT },
  })

  if (!result.available) {
    logger.warn(
      result.error
        ? `Zig setup skipped: ${result.error}`
        : 'Zig not available; postinstall is non-fatal — `pnpm run build` will retry.',
    )
  } else {
    logger.success(`Zig ready: ${result.path}`)
  }

  logger.success('Toolchain setup complete')
}

main().catch(error => {
  logger.error('Setup failed:', errorMessage(error))
  // Don't fail postinstall — Zig may not be needed for all operations.
})
