/**
 * Clean lief-builder build artifacts.
 */

import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { cleanBuilder } from 'build-infra/lib/clean-builder'

import { getDefaultLogger } from '@socketsecurity/lib/logger'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const packageDir = path.join(__dirname, '..')
const logger = getDefaultLogger()

cleanBuilder('lief-builder', {
  checkpointModes: [],
  cleanDirs: ['build', 'out'],
  packageDir,
}).catch(error => {
  logger.fail(`Clean failed: ${error.message}`)
  process.exitCode = 1
})
