#!/usr/bin/env node
/**
 * Models Package Cleanup
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
  logger.log('🧹 Cleaning Models Package')
  logger.log('='.repeat(50))

  const buildDir = path.join(packageDir, 'build')
  const distDir = path.join(packageDir, 'dist')
  let cleaned = false

  if (existsSync(buildDir)) {
    logger.log('')
    logger.log(`Removing: ${buildDir}`)
    await safeDelete(buildDir)
    logger.success('Build directory removed')
    cleaned = true
  }

  if (existsSync(distDir)) {
    logger.log('')
    logger.log(`Removing: ${distDir}`)
    await safeDelete(distDir)
    logger.success('Dist directory removed')
    cleaned = true
  }

  if (!cleaned) {
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
