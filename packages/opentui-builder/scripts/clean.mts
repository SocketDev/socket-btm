/**
 * Clean opentui-builder build artifacts.
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

cleanBuilder('opentui-builder', {
  checkpointModes: [],
  cleanDirs: ['build', 'zig-cache', '.zig-cache'],
  packageDir,
}).catch(error => {
  logger.fail(`Clean failed: ${errorMessage(error)}`)
  process.exitCode = 1
})
