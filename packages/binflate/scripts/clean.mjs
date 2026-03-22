#!/usr/bin/env node
/**
 * Clean script for binflate C package
 * Wraps the Makefile clean target for pnpm integration
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { runCommand, selectMakefile } from 'bin-infra/lib/builder'

import { getDefaultLogger } from '@socketsecurity/lib/logger'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const packageRoot = path.join(__dirname, '..')
const logger = getDefaultLogger()

async function main() {
  try {
    logger.info('Cleaning binflate...')
    const makefile = selectMakefile()
    await runCommand('make', ['-f', makefile, 'clean'], packageRoot)
    logger.success('Clean complete')
  } catch (error) {
    logger.fail(`Clean failed: ${error.message}`)
    process.exitCode = 1
  }
}

main()
