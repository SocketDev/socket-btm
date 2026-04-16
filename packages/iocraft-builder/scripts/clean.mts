/**
 * Clean iocraft-builder build artifacts.
 */

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { safeDelete } from '@socketsecurity/lib/fs'
import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { BUILD_ROOT, PACKAGE_ROOT } from './paths.mts'

const logger = getDefaultLogger()

async function main() {
  logger.step('Cleaning iocraft-builder')

  // Clean build directory.
  if (existsSync(BUILD_ROOT)) {
    logger.substep('Removing build directory...')
    await safeDelete(BUILD_ROOT, { recursive: true })
    logger.success('Removed build/')
  }

  // Clean Cargo target directory if it exists at package root.
  const targetDir = path.join(PACKAGE_ROOT, 'target')
  if (existsSync(targetDir)) {
    logger.substep('Removing Cargo target directory...')
    await safeDelete(targetDir, { recursive: true })
    logger.success('Removed target/')
  }

  logger.success('Clean complete')
}

main().catch(error => {
  logger.error('Clean failed:', error.message)
  process.exitCode = 1
})
