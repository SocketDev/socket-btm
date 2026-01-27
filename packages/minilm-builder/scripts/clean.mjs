/**
 * MiniLM Model Builder Cleanup
 *
 * Removes build artifacts and cached files.
 *
 * Usage:
 *   node scripts/clean.mjs
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { cleanBuilder } from 'build-infra/lib/clean-builder'

import { getDefaultLogger } from '@socketsecurity/lib/logger'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const packageDir = path.join(__dirname, '..')
const logger = getDefaultLogger()

cleanBuilder('minilm-builder', {
  packageDir,
  checkpointModes: [],
}).catch(error => {
  logger.fail(`Clean failed: ${error.message}`)
  process.exit(1)
})
