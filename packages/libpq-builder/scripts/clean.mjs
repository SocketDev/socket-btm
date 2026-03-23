/**
 * Clean script for libpq-builder package.
 * Removes all build artifacts and checkpoints.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { cleanPackage } from 'build-infra/lib/package-cleaner'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const packageRoot = path.join(__dirname, '..')

cleanPackage({
  packageDir: packageRoot,
  packageName: 'libpq-builder',
})
