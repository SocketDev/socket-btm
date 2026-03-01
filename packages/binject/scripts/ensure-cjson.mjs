/**
 * Utility for initializing cJSON submodule on-demand.
 * Used by binject for JSON parsing of sea-config.json (smol config extraction).
 */

import { existsSync } from 'node:fs'
import path from 'node:path'

import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

const logger = getDefaultLogger()

/**
 * Ensure cJSON submodule is initialized.
 * Checks if cJSON upstream exists and initializes it if needed.
 *
 * @param {object} options - Initialization options.
 * @param {string} options.packageDir - Package directory path (binject package).
 * @returns {Promise<void>}
 */
export async function ensureCjson({ packageDir }) {
  const cjsonUpstream = path.join(packageDir, 'upstream/cJSON')

  // Check if cJSON submodule is already initialized.
  const cjsonHeader = path.join(cjsonUpstream, 'cJSON.h')
  if (existsSync(cjsonHeader)) {
    logger.success('cJSON submodule already initialized')
    return
  }

  logger.info('Initializing cJSON submodule...')
  logger.log(
    'Running: git submodule update --init --recursive packages/binject/upstream/cJSON',
  )

  // Initialize cJSON submodule with error handling for missing .git directory.
  let result
  try {
    result = await spawn(
      'git',
      [
        'submodule',
        'update',
        '--init',
        '--recursive',
        'packages/binject/upstream/cJSON',
      ],
      {
        cwd: path.join(packageDir, '../..'),
        stdio: 'inherit',
      },
    )
  } catch (error) {
    throw new Error(
      'cJSON submodule not initialized and git command failed. ' +
        'Ensure .git directory exists and run: git submodule update --init --recursive packages/binject/upstream/cJSON\n' +
        `Error: ${error.message}`,
    )
  }

  if (result.code !== 0) {
    throw new Error(
      `Failed to initialize cJSON submodule (exit code ${result.code}). ` +
        'Run: git submodule update --init --recursive packages/binject/upstream/cJSON',
    )
  }

  // Verify initialization succeeded.
  if (!existsSync(cjsonHeader)) {
    throw new Error(
      'cJSON submodule initialization completed but cJSON.h is missing. ' +
        'The submodule may not be properly configured.',
    )
  }

  logger.success('cJSON submodule initialized successfully')
}
