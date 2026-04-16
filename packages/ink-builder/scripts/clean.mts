/**
 * Clean ink-builder build artifacts.
 */

import process from 'node:process'

import { safeDelete } from '@socketsecurity/lib/fs'
import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { BUILD_DIR, DIST_DIR } from './paths.mts'

const logger = getDefaultLogger()

async function main() {
  logger.step('Cleaning ink-builder')
  for (const dir of [BUILD_DIR, DIST_DIR]) {
    try {
      await safeDelete(dir)
      logger.success(`Removed ${dir.split('/').pop()}/`)
    } catch {
      // Ignore if doesn't exist.
    }
  }
  logger.success('Clean complete')
}

main().catch(error => {
  logger.error('Clean failed:', error.message)
  process.exitCode = 1
})
