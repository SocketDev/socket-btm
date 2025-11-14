/**
 * Clean onnxruntime build artifacts.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { cleanCheckpoint } from 'build-infra/lib/checkpoint-manager'

import { safeDelete } from '@socketsecurity/lib/fs'
import { getDefaultLogger } from '@socketsecurity/lib/logger'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = path.join(__dirname, '..')
const BUILD_DIR = path.join(ROOT_DIR, 'build')

const logger = getDefaultLogger()

async function clean() {
  logger.info('Cleaning onnxruntime build artifacts...')

  await safeDelete(BUILD_DIR)
  logger.success('Build directory cleaned')

  // Clean checkpoints for both prod and dev modes.
  for (const mode of ['prod', 'dev']) {
    const modeDir = path.join(BUILD_DIR, mode)
    await cleanCheckpoint(modeDir, '')
  }
  logger.success('Checkpoints cleaned')
}

clean().catch(e => {
  logger.error(e.message)
  process.exit(1)
})
