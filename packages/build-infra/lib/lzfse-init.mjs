/**
 * Shared utility for initializing lzfse submodule on-demand.
 * Used by binject, binpress, binflate, and other packages that need lzfse compression.
 */

import { existsSync } from 'node:fs'
import path from 'node:path'

import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

const logger = getDefaultLogger()

/**
 * Ensure lzfse submodule is initialized.
 * Checks if lzfse upstream exists and initializes it if needed.
 *
 * @param {object} options - Initialization options.
 * @param {string} options.packageDir - Package directory path.
 * @returns {Promise<void>}
 */
export async function ensureLzfse({ packageDir }) {
  const lzfseUpstream = path.join(packageDir, '../bin-infra/upstream/lzfse')

  // Check if lzfse submodule is already initialized.
  const lzfseCMakeLists = path.join(lzfseUpstream, 'CMakeLists.txt')
  if (existsSync(lzfseCMakeLists)) {
    logger.success('lzfse submodule already initialized')
    return
  }

  logger.info('Initializing lzfse submodule...')
  logger.log(
    'Running: git submodule update --init --recursive packages/bin-infra/upstream/lzfse',
  )

  // Initialize lzfse submodule with error handling for missing .git directory.
  let result
  try {
    result = await spawn(
      'git',
      [
        'submodule',
        'update',
        '--init',
        '--recursive',
        'packages/bin-infra/upstream/lzfse',
      ],
      {
        cwd: path.join(packageDir, '../..'),
        stdio: 'inherit',
      },
    )
  } catch (error) {
    throw new Error(
      'lzfse submodule not initialized and git command failed. ' +
        'Ensure .git directory exists and run: git submodule update --init --recursive packages/bin-infra/upstream/lzfse\n' +
        `Error: ${error.message}`,
    )
  }

  if (result.code !== 0) {
    throw new Error(
      `Failed to initialize lzfse submodule (exit code ${result.code}). ` +
        'Run: git submodule update --init --recursive packages/bin-infra/upstream/lzfse',
    )
  }

  // Verify initialization succeeded.
  if (!existsSync(lzfseCMakeLists)) {
    throw new Error(
      'lzfse submodule initialization completed but CMakeLists.txt is missing. ' +
        'The submodule may not be properly configured.',
    )
  }

  logger.success('lzfse submodule initialized successfully')
}
