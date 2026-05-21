import { promises as fs } from 'node:fs'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger'

import { LIB_DIR } from './paths.mts'
import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'

const logger = getDefaultLogger()

async function main() {
  logger.step('Cleaning ultraviolet-builder outputs')
  await safeDelete(LIB_DIR)
  logger.success(`Removed ${LIB_DIR}`)
}

main().catch(error => {
  logger.error(String(error?.message || error))
  throw error
})
