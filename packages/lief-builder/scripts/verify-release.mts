#!/usr/bin/env node
/**
 * Verify LIEF release artifacts before archiving.
 * Called by CI workflow to ensure all required files are present.
 *
 * Usage: node scripts/verify-release.mts <directory>
 */

import path from 'node:path'
import process from 'node:process'

import { fileURLToPath } from 'node:url'

import { errorMessage } from 'build-infra/lib/error-utils'
import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { verifyLiefAt } from './build.mts'

const logger = getDefaultLogger()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const packageRoot = path.join(__dirname, '..')

function main() {
  const dir = process.argv[2]

  if (!dir) {
    throw new Error('Usage: node scripts/verify-release.mts <directory>')
  }

  const absoluteDir = path.isAbsolute(dir) ? dir : path.join(process.cwd(), dir)

  logger.info(`Verifying LIEF release at: ${absoluteDir}`)

  const result = verifyLiefAt(absoluteDir)

  if (result.valid) {
    logger.success('All required LIEF files verified')
  } else {
    logger.error('Missing required files:')
    for (const file of result.missing) {
      logger.error(`  - ${file}`)
    }
    throw new Error('LIEF release verification failed')
  }
}

try {
  main()
} catch (e) {
  logger.error(errorMessage(e))
  process.exitCode = 1
}
