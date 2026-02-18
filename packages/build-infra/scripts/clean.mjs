/**
 * build-infra Package Cleanup
 *
 * Removes build artifacts and cached files.
 *
 * Usage:
 *   node scripts/clean.mjs
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { cleanBuilder } from '../lib/clean-builder.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const packageDir = path.join(__dirname, '..')
const logger = getDefaultLogger()

// build-infra stores downloaded artifacts (cmake, ninja, etc.) in build/
cleanBuilder('build-infra', {
  packageDir,
  cleanDirs: ['build'],
  checkpointModes: [],
}).catch(error => {
  logger.fail(`Clean failed: ${error.message}`)
  process.exit(1)
})
