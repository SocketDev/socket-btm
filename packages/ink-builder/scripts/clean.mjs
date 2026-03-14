/**
 * Clean script for ink package.
 *
 * Removes build artifacts.
 */

import { promises as fs } from 'node:fs'

import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { safeDelete } from '@socketsecurity/lib/fs'

import { BUILD_DIR, DIST_DIR } from './paths.mjs'

const logger = getDefaultLogger()

async function main() {
  logger.step('Cleaning ink build artifacts')

  // Remove build directory.
  try {
    await safeDelete(BUILD_DIR)
    logger.success('Removed build/')
  } catch {
    // Ignore if doesn't exist.
  }

  // Remove dist directory.
  try {
    await safeDelete(DIST_DIR)
    logger.success('Removed dist/')
  } catch {
    // Ignore if doesn't exist.
  }

  logger.success('Clean complete')
}

main().catch(error => {
  logger.error('Clean failed:', error.message)
  process.exitCode = 1
})
