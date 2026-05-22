#!/usr/bin/env node
/**
 * Clean dawn-builder's build output.
 *
 * Removes everything under build/ but leaves upstream/ (submodule)
 * + scripts/ + lib/ + node_modules/ alone.
 */

import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger'

import { BUILD_ROOT } from './paths.mts'

const logger = getDefaultLogger()

async function main(): Promise<void> {
  logger.info(`Cleaning ${BUILD_ROOT}`)
  await safeDelete(BUILD_ROOT)
  logger.success('Clean complete')
}

main().catch(err => {
  logger.fail(`Failed: ${err}`)
  process.exitCode = 1
})
