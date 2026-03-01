#!/usr/bin/env node
/**
 * @fileoverview Setup build toolchain for binject
 *
 * Installs required system dependencies:
 * - Linux: gcc, make, cmake (LIEF library)
 * - macOS: clang (Xcode), cmake, make (LIEF library, system Compression framework)
 * - Windows: mingw-w64 (gcc/g++), cmake, make (LIEF library, Cabinet API)
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
  darwin: ['clang', 'cmake', 'make'],
  linux: ['gcc', 'make', 'cmake'],
  win32: ['mingw-w64', 'cmake', 'make'],
  darwinNote:
    'Note: Compression via system Compression framework (no extra deps)',
  linuxNote: 'Note: LZFSE compiled from upstream/lzfse submodule',
  win32Note: 'Note: Compression via Cabinet API (no extra deps)',
})

async function main() {
  logger.step('binject - Setup Build Toolchain')

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
    } else {
      logger.error('Build toolchain setup failed')
      process.exitCode = 1
    }
  })
  .catch(error => {
    logger.error('Setup failed')
    logger.error(error)
    process.exitCode = 1
  })
