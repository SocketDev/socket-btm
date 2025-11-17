/**
 * Clean codet5-models build artifacts.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { printHeader, printSuccess } from 'build-infra/lib/build-output'
import { cleanCheckpoint } from 'build-infra/lib/checkpoint-manager'

import { safeDelete } from '@socketsecurity/lib/fs'
import loggerPkg from '@socketsecurity/lib/logger'

const logger = loggerPkg.getDefaultLogger()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const ROOT_DIR = path.join(__dirname, '..')
const MODELS_DIR = path.join(ROOT_DIR, '.models')
const BUILD_DIR = path.join(ROOT_DIR, 'build')

async function main() {
  printHeader('Cleaning codet5-models')

  // Remove models directory.
  await safeDelete(MODELS_DIR).catch(() => {})

  // Remove build directory.
  await safeDelete(BUILD_DIR).catch(() => {})

  // Clean checkpoints for both prod/dev modes and int4/int8 builds.
  for (const mode of ['prod', 'dev']) {
    for (const quant of ['int4', 'int8']) {
      const buildDir = path.join(ROOT_DIR, 'build', mode, quant)
      await cleanCheckpoint(buildDir, '')
    }
  }

  printSuccess('Clean complete')
}

main().catch(e => {
  logger.error('Clean failed:', e.message)
  process.exit(1)
})
