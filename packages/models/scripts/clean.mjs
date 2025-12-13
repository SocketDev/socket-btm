/**
 * Models Package Cleanup
 *
 * Removes build artifacts and cached files.
 *
 * Usage:
 *   node scripts/clean.mjs
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { cleanBuilder } from 'build-infra/lib/clean-builder'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const packageDir = path.join(__dirname, '..')

// Models package doesn't use checkpoints
cleanBuilder('models', {
  packageDir,
  cleanDirs: ['build', 'dist'],
  checkpointModes: [],
}).catch(error => {
  console.error('Clean failed:', error.message)
  process.exit(1)
})
