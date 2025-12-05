#!/usr/bin/env node
/**
 * @fileoverview Setup build toolchain for onnxruntime-builder
 *
 * Installs required system dependencies:
 * - cmake: Build system for ONNX Runtime
 * - python3: Required for build scripts and Emscripten
 * - emscripten: WASM compiler (via emsdk, separate installation)
 */

import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib/logger'

import {
  installTools,
  updatePackageCache,
} from '../../build-infra/lib/install-tools.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const packageRoot = path.resolve(__dirname, '..')

const logger = getDefaultLogger()
const platform = os.platform()

async function setup() {
  logger.step('onnxruntime-builder - Setup Build Toolchain')

  // Skip in CI - dependencies are installed via workflow steps
  if (process.env.CI) {
    logger.info('CI detected - skipping local toolchain setup')
    return true
  }

  // Install cmake and python3 on all platforms
  logger.log('Installing build dependencies...')

  if (platform === 'linux') {
    updatePackageCache()
  }

  const tools = ['cmake', 'python3']
  const { failed, installed } = await installTools(tools, { packageRoot })

  if (failed.length > 0) {
    logger.error(`Failed to install: ${failed.join(', ')}`)
    logger.info(
      'You may need to install these manually. See packages/build-infra/docs/prerequisites.md',
    )
    return false
  }

  logger.success(`Installed: ${installed.join(', ')}`)

  // Emscripten info
  logger.info('')
  logger.info('Emscripten (emsdk) installation:')
  logger.info(
    '  Emscripten is installed separately via emsdk during the build process',
  )
  logger.info(
    '  Version 4.0.20 will be automatically downloaded when running pnpm build',
  )
  logger.info(
    '  See: https://emscripten.org/docs/getting_started/downloads.html',
  )

  return true
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
