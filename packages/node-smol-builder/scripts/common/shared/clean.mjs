#!/usr/bin/env node
/**
 * Node.js Builder Cleanup
 *
 * Removes build artifacts and cached files.
 *
 * Usage:
 *   node scripts/clean.mjs
 *   node scripts/clean.mjs --build   (clean only build directory)
 *   node scripts/clean.mjs --dist    (clean only dist directory)
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
  const args = process.argv.slice(2)
  const cleanBuildOnly = args.includes('--build')
  const cleanDistOnly = args.includes('--dist')
  const cleanAll = !cleanBuildOnly && !cleanDistOnly

  logger.log('🧹 Cleaning Node.js Builder')
  logger.log('='.repeat(50))

  const buildDir = path.join(packageDir, 'build')
  const distDir = path.join(packageDir, 'dist')
  const cacheDir = path.join(packageDir, '.cache')
  const bootstrapFile = path.join(
    packageDir,
    'additions/002-bootstrap-loader/internal/socketsecurity_bootstrap_loader.js',
  )
  let cleaned = false

  if (cleanAll || cleanBuildOnly) {
    if (existsSync(buildDir)) {
      logger.log('')
      logger.log(`Removing: ${buildDir}`)
      await safeDelete(buildDir)
      logger.success('Build directory removed')
      cleaned = true
    }
  }

  if (cleanAll || cleanDistOnly) {
    if (existsSync(distDir)) {
      logger.log('')
      logger.log(`Removing: ${distDir}`)
      await safeDelete(distDir)
      logger.success('Dist directory removed')
      cleaned = true
    }
  }

  if (cleanAll) {
    if (existsSync(cacheDir)) {
      logger.log('')
      logger.log(`Removing: ${cacheDir}`)
      await safeDelete(cacheDir)
      logger.success('Cache directory removed')
      cleaned = true
    }

    if (existsSync(bootstrapFile)) {
      logger.log('')
      logger.log(`Removing: ${bootstrapFile}`)
      await safeDelete(bootstrapFile)
      logger.success('Bootstrap loader file removed')
      cleaned = true
    }
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
