/**
 * Clean the napi-go example build outputs.
 */

import { promises as fs } from 'node:fs'

import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { LIB_DIR } from './paths.mts'

const logger = getDefaultLogger()

async function main() {
  logger.step('Cleaning napi-go build outputs')
  await fs.rm(LIB_DIR, { recursive: true, force: true })
  logger.success(`Removed ${LIB_DIR}`)
}

main().catch(error => {
  logger.error(String(error?.message || error))
  throw error
})
