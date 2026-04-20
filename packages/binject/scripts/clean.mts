#!/usr/bin/env node
/**
 * Clean script for binject C package
 * Wraps the Makefile clean target for pnpm integration
 */

import path from 'node:path'
import process from 'node:process'

import { fileURLToPath } from 'node:url'

import { runCommand, selectMakefile } from 'bin-infra/lib/builder'

import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { errorMessage } from 'build-infra/lib/error-utils'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const packageRoot = path.join(__dirname, '..')
const logger = getDefaultLogger()

async function main() {
  try {
    logger.info('Cleaning binject...')
    const makefile = selectMakefile()
    await runCommand('make', ['-f', makefile, 'clean'], packageRoot)
    logger.success('Clean complete')
  } catch (error) {
    logger.fail(`Clean failed: ${errorMessage(error)}`)
    process.exitCode = 1
  }
}

main().catch(e => {
  logger.error(errorMessage(e))
  process.exitCode = 1
})
