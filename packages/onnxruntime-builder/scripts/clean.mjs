/**
 * Clean onnxruntime build artifacts.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { cleanBuilder } from 'build-infra/lib/clean-builder'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const packageDir = path.join(__dirname, '..')
const logger = getDefaultLogger()

cleanBuilder('onnxruntime-builder', { packageDir }).catch(error => {
  logger.fail(`Clean failed: ${error.message}`)
  process.exit(1)
})
