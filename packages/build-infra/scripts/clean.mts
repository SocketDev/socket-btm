/**
 * build-infra Package Cleanup
 *
 * Removes build artifacts and cached files.
 *
 * Usage:
 *   node scripts/clean.mts
 */

import path from 'node:path'
import process from 'node:process'

import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { cleanBuilder } from '../lib/clean-builder.mts'
import { errorMessage } from '../lib/error-utils.mts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const packageDir = path.join(__dirname, '..')
const logger = getDefaultLogger()

// build-infra stores downloaded artifacts (cmake, ninja, etc.) in build/
cleanBuilder('build-infra', {
  checkpointModes: [],
  cleanDirs: ['build'],
  packageDir,
}).catch(error => {
  logger.fail(`Clean failed: ${errorMessage(error)}`)
  process.exitCode = 1
})
