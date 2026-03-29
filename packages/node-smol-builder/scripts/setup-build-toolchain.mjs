#!/usr/bin/env node
/**
 * @fileoverview Setup build toolchain for node-smol-builder
 *
 * Installs required system dependencies:
 * - Linux: gcc, make, libssl-dev
 * - macOS: clang (Xcode), make, openssl@3
 * - Windows: mingw-w64, make
 */

import path from 'node:path'
import process from 'node:process'

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
  linux: ['gcc', 'make', 'libssl-dev'],
  win32: ['mingw-w64', 'make'],
})

async function main() {
  if (isCI()) {
    // Single-line CI output to reduce log noise
    logger.success('node-smol-builder toolchain: CI mode (skipped)')
    return true
  }

  logger.step('node-smol-builder - Setup Build Toolchain')
  return setup(packageRoot)
}

main()
  .then(success => {
    if (success && !isCI()) {
      logger.success('Build toolchain setup complete')
    } else if (!success) {
      logger.error('Build toolchain setup failed')
      process.exitCode = 1
    }
  })
  .catch(error => {
    logger.error('Setup failed')
    logger.error(error)
    process.exitCode = 1
  })
