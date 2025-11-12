/**
 * Clean yoga-layout build artifacts.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { printHeader, printSuccess } from 'build-infra/lib/build-output'
import { cleanCheckpoint } from 'build-infra/lib/checkpoint-manager'

import { safeDelete } from '@socketsecurity/lib/fs'
import { getDefaultLogger } from '@socketsecurity/lib/logger'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const ROOT_DIR = path.join(__dirname, '..')
const BUILD_DIR = path.join(ROOT_DIR, 'build')

async function main() {
  printHeader('Cleaning yoga-layout')

  // Remove build directory (includes source).
  await safeDelete(BUILD_DIR)

  // Clean checkpoints.
  await cleanCheckpoint(BUILD_DIR, 'yoga-layout')

  printSuccess('Clean complete')
}

main().catch(e => {
  const logger = getDefaultLogger()
  logger.error('Clean failed:', e.message)
  process.exit(1)
})
