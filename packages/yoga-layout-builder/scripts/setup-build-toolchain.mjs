#!/usr/bin/env node
/**
 * @fileoverview Setup build toolchain for yoga-layout-builder
 *
 * Installs required system dependencies:
 * - Linux: gcc, make, cmake, python3
 * - macOS: clang (Xcode), make, cmake, python3
 * - Windows: mingw-w64, make, cmake, python3
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib/logger'

import {
  createSetupToolchain,
  isCI,
} from '../../build-infra/lib/setup-build-toolchain.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const packageRoot = path.resolve(__dirname, '..')
const logger = getDefaultLogger()

const setup = createSetupToolchain({
  darwin: ['clang', 'make', 'cmake', 'python3'],
  linux: ['gcc', 'make', 'cmake', 'python3'],
  win32: ['mingw-w64', 'make', 'cmake', 'python3'],
})

async function main() {
  logger.step('yoga-layout-builder - Setup Build Toolchain')

  if (isCI()) {
    logger.info('CI detected - skipping local toolchain setup')
    return true
  }

  return setup(packageRoot)
}

main()
  .then(success => {
    if (success) {
      logger.success('Build toolchain setup complete')
      process.exit(0)
    } else {
      logger.error('Build toolchain setup failed')
      process.exit(1)
    }
  })
  .catch(error => {
    logger.error('Setup failed')
    logger.error(error)
    process.exit(1)
  })
