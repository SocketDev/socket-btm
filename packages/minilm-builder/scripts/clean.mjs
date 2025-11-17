#!/usr/bin/env node
/**
 * MiniLM Model Builder Cleanup
 *
 * Removes build artifacts and cached files.
 *
 * Usage:
 *   node scripts/clean.mjs
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { safeDelete } from '@socketsecurity/lib/fs'
import { getDefaultLogger } from '@socketsecurity/lib/logger'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const packageDir = path.join(__dirname, '..')

/**
 * Main entry point.
 */
async function main() {
  const logger = getDefaultLogger()
  logger.log('🧹 Cleaning MiniLM Builder')
  logger.log('='.repeat(50))

  const buildDir = path.join(packageDir, 'build')

  if (existsSync(buildDir)) {
    logger.log('')
    logger.log(`Removing: ${buildDir}`)
    await safeDelete(buildDir)
    logger.success('Build directory removed')
  } else {
    logger.log('')
    logger.success('Nothing to clean')
  }

  logger.log('')
  logger.success('Clean complete!')
}

const logger = getDefaultLogger()
main().catch(error => {
  logger.error('\n✗ Clean failed:', error.message)
  process.exit(1)
})
