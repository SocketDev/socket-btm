#!/usr/bin/env node
/**
 * @fileoverview Setup build toolchain for onnxruntime-builder
 *
 * Installs required system dependencies:
 * - Linux: gcc, make, cmake, python3
 * - macOS: clang (Xcode), make, cmake, python3
 * - Windows: mingw-w64, make, cmake, python3
 */

import path from 'node:path'
import process from 'node:process'

import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib/logger'

import {
  createSetupToolchain,
  isCI,
} from 'build-infra/lib/setup-build-toolchain'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const packageRoot = path.resolve(__dirname, '..')
const logger = getDefaultLogger()

const setup = createSetupToolchain({
  darwin: ['clang', 'make', 'cmake', 'python3'],
  linux: ['gcc', 'make', 'cmake', 'python3'],
  win32: ['mingw-w64', 'make', 'cmake', 'python3'],
})

async function main() {
  if (isCI()) {
    // Single-line CI output to reduce log noise
    logger.success('onnxruntime-builder toolchain: CI mode (skipped)')
    return true
  }

  logger.step('onnxruntime-builder - Setup Build Toolchain')
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
