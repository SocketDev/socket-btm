#!/usr/bin/env node
/**
 * Clean script for binject C package
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
    logger.step('Cleaning binject build artifacts...')

    // Select platform-specific Makefile.
    let makefile = 'Makefile.macos'
    if (process.platform === 'linux') {
      makefile = 'Makefile.linux'
    } else if (process.platform === 'win32') {
      makefile = 'Makefile.windows'
    }

    await runCommand('make', ['-f', makefile, 'clean'], packageRoot)
    logger.success('Clean completed successfully!')
  } catch (error) {
    logger.fail(`Clean failed: ${error.message}`)
    process.exit(1)
  }
}

main()
