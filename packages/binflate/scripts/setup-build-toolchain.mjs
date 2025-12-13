#!/usr/bin/env node
/**
 * @fileoverview Setup build toolchain for binflate
 *
 * Installs required system dependencies:
 * - Linux: liblzma-dev, libssl-dev (for LZMA decompression)
 * - macOS: Uses system Compression framework (no extra deps)
 * - Windows: Uses Cabinet API (no extra deps)
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
  logger.step('binflate - Setup Build Toolchain')

  // Skip in CI - dependencies are installed via workflow steps
  if (process.env.CI) {
    logger.info('CI detected - skipping local toolchain setup')
    return true
  }

  // macOS and Windows don't need extra dependencies
  if (platform === 'darwin') {
    logger.info('macOS: Using system Compression framework (no setup needed)')
    return true
  }

  if (platform === 'win32') {
    logger.info('Windows: Using Cabinet API (no setup needed)')
    return true
  }

  // Linux: Install liblzma-dev and libssl-dev
  if (platform === 'linux') {
    logger.log('Installing Linux build dependencies...')
    updatePackageCache()

    const tools = ['liblzma-dev', 'libssl-dev']
    const { failed, installed } = await installTools(tools, { packageRoot })

    if (failed.length > 0) {
      logger.error(`Failed to install: ${failed.join(', ')}`)
      logger.info(
        'You may need to install these manually. See packages/build-infra/docs/prerequisites.md',
      )
      return false
    }

    logger.success(`Installed: ${installed.join(', ')}`)
    return true
  }

  logger.warn(`Unsupported platform: ${platform}`)
  return false
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
