/**
 * Shared utility for initializing zstd submodule on-demand.
 * Used by binject, binpress, binflate, stubs-builder, and other packages
 * that need zstd compression/decompression.
 */

import { existsSync } from 'node:fs'
import path from 'node:path'

import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

const logger = getDefaultLogger()

/**
 * Ensure zstd submodule is initialized.
 * Checks if zstd upstream exists and initializes it if needed.
 *
 * @param {object} options - Initialization options.
 * @param {string} options.packageDir - Package directory path.
 * @returns {Promise<void>}
 */
export async function ensureZstd({ packageDir }) {
  const zstdUpstream = path.join(packageDir, '../bin-infra/upstream/zstd')

  // Check if zstd submodule is already initialized.
  const zstdHeader = path.join(zstdUpstream, 'lib', 'zstd.h')
  if (existsSync(zstdHeader)) {
    logger.success('zstd submodule already initialized')
    return
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
        cwd: path.join(packageDir, '../..'),
        stdio: 'inherit',
      },
    )
  } catch (error) {
    throw new Error(
      'zstd submodule not initialized and git command failed. ' +
        'Ensure .git directory exists and run: git submodule update --init packages/bin-infra/upstream/zstd\n' +
        `Error: ${error.message}`,
      { cause: error },
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
