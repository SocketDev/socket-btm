#!/usr/bin/env node
/**
 * Clean script for binpress C package
 * Wraps the Makefile clean target for pnpm integration
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { runCommand } from '../../build-infra/lib/script-runner.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const packageRoot = path.join(__dirname, '..')
const logger = getDefaultLogger()

async function main() {
  try {
    logger.step('Cleaning binpress build artifacts...')
    await runCommand('make', ['clean'], packageRoot)
    logger.success('Clean completed successfully!')
  } catch (error) {
    logger.fail(`Clean failed: ${error.message}`)
    process.exit(1)
  }
}

main()
