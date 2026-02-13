/**
 * Shared utility for initializing libdeflate submodule on-demand.
 * Used by binject for high-performance gzip compression on Linux/Windows.
 */

import { existsSync } from 'node:fs'
import path from 'node:path'

import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

const logger = getDefaultLogger()

/**
 * Ensure libdeflate submodule is initialized.
 * Checks if libdeflate upstream exists and initializes it if needed.
 *
 * @param {object} options - Initialization options.
 * @param {string} options.packageDir - Package directory path (binject package).
 * @returns {Promise<void>}
 */
export async function ensureLibdeflate({ packageDir }) {
  const libdeflateUpstream = path.join(packageDir, 'upstream/libdeflate')

  // Check if libdeflate submodule is already initialized.
  const libdeflateHeader = path.join(libdeflateUpstream, 'libdeflate.h')
  if (existsSync(libdeflateHeader)) {
    logger.success('libdeflate submodule already initialized')
    return
  }

  logger.info('Initializing libdeflate submodule...')
  logger.log(
    'Running: git submodule update --init --recursive packages/binject/upstream/libdeflate',
  )

  // Initialize libdeflate submodule with error handling for missing .git directory.
  let result
  try {
    result = await spawn(
      'git',
      [
        'submodule',
        'update',
        '--init',
        '--recursive',
        'packages/binject/upstream/libdeflate',
      ],
      {
        cwd: path.join(packageDir, '../..'),
        stdio: 'inherit',
      },
    )
  } catch (error) {
    throw new Error(
      'libdeflate submodule not initialized and git command failed. ' +
        'Ensure .git directory exists and run: git submodule update --init --recursive packages/binject/upstream/libdeflate\n' +
        `Error: ${error.message}`,
    )
  }

  if (result.code !== 0) {
    throw new Error(
      `Failed to initialize libdeflate submodule (exit code ${result.code}). ` +
        'Run: git submodule update --init --recursive packages/binject/upstream/libdeflate',
    )
  }

  // Verify initialization succeeded.
  if (!existsSync(libdeflateHeader)) {
    throw new Error(
      'libdeflate submodule initialization completed but libdeflate.h is missing. ' +
        'The submodule may not be properly configured.',
    )
  }

  logger.success('libdeflate submodule initialized successfully')
}
