#!/usr/bin/env node
/**
 * Clean script for bin-stubs package.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { safeDelete } from '@socketsecurity/lib/fs'
import { getDefaultLogger } from '@socketsecurity/lib/logger'

const logger = getDefaultLogger()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const packageRoot = path.join(__dirname, '..')

async function clean() {
  const dirsToClean = ['build', 'out']

  for (const dir of dirsToClean) {
    const fullPath = path.join(packageRoot, dir)
    try {
      await safeDelete(fullPath)
      logger.success(`Deleted ${dir}/`)
    } catch {
      // Directory doesn't exist or couldn't be deleted, skip it.
    }
  }
}

clean().catch(error => {
  logger.error('Error during clean:', error)
  process.exitCode = 1
})
