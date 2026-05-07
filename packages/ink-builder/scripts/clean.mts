/**
 * Clean ink-builder build artifacts.
 */

import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { cleanBuilder } from 'build-infra/lib/clean-builder'
import { errorMessage } from 'build-infra/lib/error-utils'

import { getDefaultLogger } from '@socketsecurity/lib/logger'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const packageDir = path.join(__dirname, '..')
const logger = getDefaultLogger()

cleanBuilder('ink-builder', {
  // ink-builder has no checkpoint chain; just blow away build/ and dist/.
  checkpointModes: [],
  cleanDirs: ['build', 'dist'],
  packageDir,
}).catch(error => {
  logger.fail(`Clean failed: ${errorMessage(error)}`)
  process.exitCode = 1
})
