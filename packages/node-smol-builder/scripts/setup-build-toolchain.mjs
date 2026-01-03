#!/usr/bin/env node
/**
 * @fileoverview Setup build toolchain for node-smol-builder
 *
 * Installs required system dependencies:
 * - Linux: gcc, make, liblzma-dev, libssl-dev
 * - macOS: clang (Xcode), make, openssl@3
 * - Windows: mingw-w64, make
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
  darwin: ['clang', 'make', 'openssl@3'],
  linux: ['gcc', 'make', 'liblzma-dev', 'libssl-dev'],
  win32: ['mingw-w64', 'make'],
})

async function main() {
  logger.step('node-smol-builder - Setup Build Toolchain')

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
