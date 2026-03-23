/**
 * Models Package Cleanup
 *
 * Removes build artifacts and cached files.
 *
 * Usage:
 *   node scripts/clean.mjs
 */

import path from 'node:path'
import process from 'node:process'

import { fileURLToPath } from 'node:url'

import { cleanBuilder } from 'build-infra/lib/clean-builder'

import { getDefaultLogger } from '@socketsecurity/lib/logger'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const packageDir = path.join(__dirname, '..')
const logger = getDefaultLogger()

// Models package uses build/ directory with dev/prod modes
cleanBuilder('models', {
  checkpointModes: [],
  cleanDirs: ['build'],
  packageDir,
}).catch(error => {
  logger.fail(`Clean failed: ${error.message}`)
  process.exitCode = 1
})
