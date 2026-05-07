/**
 * Shared utility for initializing zstd submodule on-demand.
 * Used by binject, binpress, binflate, stubs-builder, and other packages
 * that need zstd compression/decompression.
 */

import { existsSync } from 'node:fs'
import path from 'node:path'

import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

import { errorMessage } from './error-utils.mts'

const logger = getDefaultLogger()

/**
 * Ensure zstd submodule is initialized.
 * Checks if zstd upstream exists and initializes it if needed.
 * In Docker builds (no .git), skips git init — the workflow must
 * ensure the submodule is initialized before `docker build`.
 *
 * @param {object} options - Initialization options.
 * @param {string} options.packageDir - Package directory path.
 * @returns {Promise<void>}
 */
export async function ensureZstd({ packageDir }) {
  const zstdUpstream = path.join(packageDir, '../bin-infra/upstream/zstd')
  const monorepoRoot = path.join(packageDir, '../..')

  // Check if zstd submodule is already initialized.
  const zstdHeader = path.join(zstdUpstream, 'lib', 'zstd.h')
  if (existsSync(zstdHeader)) {
    logger.success('zstd submodule already initialized')
    return
  }

  // In Docker builds there's no .git — the submodule must be in the build context.
  const gitDir = path.join(monorepoRoot, '.git')
  if (!existsSync(gitDir)) {
    throw new Error(
      'zstd source not found and no .git directory available.\n' +
        'In Docker builds, ensure the CI workflow initializes the zstd submodule\n' +
        'before docker build: git submodule update --init packages/bin-infra/upstream/zstd',
    )
  }

  logger.info('Initializing zstd submodule...')
  logger.log(
    'Running: git submodule update --init packages/bin-infra/upstream/zstd',
  )

  let result
  try {
    result = await spawn(
      'git',
      [
        'submodule',
        'update',
        '--init',
        'packages/bin-infra/upstream/zstd',
      ],
      {
        cwd: monorepoRoot,
        stdio: 'inherit',
      },
    )
  } catch (e) {
    throw new Error(
      'zstd submodule not initialized and git command failed. ' +
        'Run: git submodule update --init packages/bin-infra/upstream/zstd\n' +
        `Error: ${errorMessage(e)}`,
      { cause: e },
    )
  }

  if (result.code !== 0) {
    throw new Error(
      `Failed to initialize zstd submodule (exit code ${result.code}). ` +
        'Run: git submodule update --init packages/bin-infra/upstream/zstd',
    )
  }

  // Verify initialization succeeded.
  if (!existsSync(zstdHeader)) {
    throw new Error(
      'zstd submodule initialization completed but zstd.h is missing. ' +
        'The submodule may not be properly configured.',
    )
  }

  logger.success('zstd submodule initialized successfully')
}
