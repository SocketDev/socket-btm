/**
 * Source extraction phase for Yoga Layout
 *
 * Extracts pristine source from shared checkpoint to mode-specific directory.
 */

import { existsSync } from 'node:fs'

import { printError } from 'build-infra/lib/build-output'
import { restoreCheckpoint } from 'build-infra/lib/checkpoint-manager'

import { getDefaultLogger } from '@socketsecurity/lib/logger'

const logger = getDefaultLogger()

/**
 * Extract pristine source from shared checkpoint to mode-specific directory.
 * This gives each build mode (dev/prod) its own isolated copy.
 *
 * @param {object} options - Extraction options
 * @param {string} options.buildMode - Build mode ('prod' or 'dev')
 * @param {string} options.buildDir - Build directory
 * @param {string} options.sharedBuildDir - Shared build directory
 * @param {string} options.modeSourceDir - Mode-specific source directory
 */
export async function extractSourceForMode(options) {
  const { buildDir, buildMode, modeSourceDir, sharedBuildDir } = options

  // Skip if mode-specific source already exists
  if (existsSync(modeSourceDir)) {
    return
  }

  logger.step(`Extracting Yoga Source to ${buildMode} Build`)
  logger.log(`Extracting from shared checkpoint to ${buildMode}/source...`)

  // Extract shared checkpoint to mode-specific directory
  const restored = await restoreCheckpoint(
    sharedBuildDir,
    '',
    'source-cloned',
    { destDir: buildDir },
  )

  if (!restored) {
    printError(
      'Source Extraction Failed',
      'Shared checkpoint not found. Run with --clean to rebuild.',
    )
    throw new Error('Source extraction failed')
  }

  logger.success(`Source extracted to ${buildMode}/source`)
}
