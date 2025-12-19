#!/usr/bin/env node
/**
 * @fileoverview Setup build toolchain for yoga-layout-builder
 *
 * Installs required system dependencies:
 * - Linux: gcc, g++, make, cmake, python3
 * - macOS: clang (Xcode), make, cmake, python3
 * - Windows: mingw-w64 (gcc/g++), make, cmake, python3
 * - emscripten: WASM compiler (via emsdk, installed during build)
 */

import os from 'node:os'

import { getLogger, isCI } from './setup-build-toolchain/shared.mjs'

const logger = getLogger()
const platform = os.platform()

async function setup() {
  logger.step('yoga-layout-builder - Setup Build Toolchain')

  // Skip in CI - dependencies are installed via workflow steps
  if (isCI()) {
    logger.info('CI detected - skipping local toolchain setup')
    return true
  }

  // Import and run platform-specific setup
  let platformSetup
  try {
    if (platform === 'darwin') {
      platformSetup = await import('./setup-build-toolchain/darwin.mjs')
    } else if (platform === 'win32') {
      platformSetup = await import('./setup-build-toolchain/windows.mjs')
    } else if (platform === 'linux') {
      platformSetup = await import('./setup-build-toolchain/linux.mjs')
    } else {
      logger.warn(`Unsupported platform: ${platform}`)
      return false
    }

    return await platformSetup.setup()
  } catch (error) {
    logger.error(`Failed to load platform setup: ${error.message}`)
    throw error
  }
}

setup()
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
