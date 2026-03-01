/**
 * Clean script for node-smol-builder
 *
 * Usage:
 *   pnpm clean - Clean build directory
 */

import { existsSync } from 'node:fs'
import path from 'node:path'

import { safeDelete } from '@socketsecurity/lib/fs'
import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { BUILD_ROOT } from './paths.mjs'

const logger = getDefaultLogger()

async function clean() {
  logger.info(`🧹 Cleaning ${path.basename(BUILD_ROOT)} build directory…`)
  logger.log('')

  if (existsSync(BUILD_ROOT)) {
    await safeDelete(BUILD_ROOT)
    logger.success('Cleaned build/')
  } else {
    logger.info('build/ does not exist')
  }

  logger.log('')
  logger.success('Clean complete')
}

clean().catch(e => {
  logger.fail(`Clean failed: ${e?.message || 'Unknown error'}`)
  process.exitCode = 1
})
