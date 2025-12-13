/**
 * Clean onnxruntime build artifacts.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { cleanBuilder } from 'build-infra/lib/clean-builder'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const packageDir = path.join(__dirname, '..')

cleanBuilder('onnxruntime-builder', { packageDir }).catch(e => {
  console.error(e.message)
  process.exit(1)
})
