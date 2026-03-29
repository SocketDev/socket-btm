#!/usr/bin/env node
/**
 * Verify LIEF release artifacts before archiving.
 * Called by CI workflow to ensure all required files are present.
 *
 * Usage: node scripts/verify-release.mjs <directory>
 */

import path from 'node:path'
import process from 'node:process'

import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { verifyLiefAt } from './build.mjs'

const logger = getDefaultLogger()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const packageRoot = path.join(__dirname, '..')

function main() {
  const dir = process.argv[2]

  if (!dir) {
    logger.error('Usage: node scripts/verify-release.mjs <directory>')
    process.exit(1)
  }

  const absoluteDir = path.isAbsolute(dir) ? dir : path.join(process.cwd(), dir)

  logger.info(`Verifying LIEF release at: ${absoluteDir}`)

  const result = verifyLiefAt(absoluteDir)

  if (result.valid) {
    logger.success('All required LIEF files verified')
    process.exit(0)
  } else {
    logger.error('Missing required files:')
    for (const file of result.missing) {
      logger.error(`  - ${file}`)
    }
    process.exit(1)
  }
}

main()
