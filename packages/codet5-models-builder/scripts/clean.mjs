/**
 * Clean codet5-models build artifacts.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { cleanBuilder } from 'build-infra/lib/clean-builder'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const packageDir = path.join(__dirname, '..')

cleanBuilder('codet5-models-builder', {
  packageDir,
  cleanDirs: ['.models', 'build'],
  checkpointModes: [],
}).catch(error => {
  console.error('Clean failed:', error.message)
  process.exit(1)
})
