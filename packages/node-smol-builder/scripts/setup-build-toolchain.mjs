#!/usr/bin/env node
/**
 * @fileoverview Setup build toolchain for node-smol-builder
 *
 * Installs required system dependencies:
 * - Linux: liblzma-dev, libssl-dev (for stub binary)
 * - Linux (musl builds): musl-tools, gcc-aarch64-linux-gnu
 * - macOS: Uses Homebrew OpenSSL
 * - Windows: Uses bundled OpenSSL
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
const arch = os.arch()

async function setup() {
  logger.step('node-smol-builder - Setup Build Toolchain')

  // Skip in CI - dependencies are installed via workflow steps
  if (process.env.CI) {
    logger.info('CI detected - skipping local toolchain setup')
    return true
  }

  // macOS: Needs OpenSSL from Homebrew
  if (platform === 'darwin') {
    logger.log('Installing macOS build dependencies...')
    const tools = ['openssl@3']
    // Homebrew manages versions differently
    const { failed, installed } = await installTools(tools, {
      packageRoot,
      skipVersionPin: true,
    })

    if (failed.length > 0) {
      logger.warn(`Failed to install: ${failed.join(', ')}`)
      logger.info('Install OpenSSL manually: brew install openssl@3')
      return false
    }

    logger.success(`Installed: ${installed.join(', ')}`)
    return true
  }

  // Windows: No setup needed (uses bundled OpenSSL)
  if (platform === 'win32') {
    logger.info('Windows: Using bundled OpenSSL (no setup needed)')
    return true
  }

  // Linux: Install development libraries
  if (platform === 'linux') {
    logger.log('Installing Linux build dependencies...')
    updatePackageCache()

    // Base dependencies for all Linux builds
    const tools = ['liblzma-dev', 'libssl-dev']

    // If building musl binaries, add musl toolchain
    // Note: This auto-detects based on current architecture
    // For cross-compilation, users need to manually install
    const buildMusl = process.env.BUILD_MUSL === 'true'
    if (buildMusl) {
      logger.log('Detected musl build - adding musl toolchain...')
      tools.push('musl-tools')

      // Add ARM64 cross-compiler if on x64
      if (arch === 'x64') {
        tools.push('gcc-aarch64-linux-gnu')
      }
    }

    const { failed, installed } = await installTools(tools, { packageRoot })

    if (failed.length > 0) {
      logger.error(`Failed to install: ${failed.join(', ')}`)
      logger.info(
        'You may need to install these manually. See packages/build-infra/docs/prerequisites.md',
      )
      return false
    }

    logger.success(`Installed: ${installed.join(', ')}`)

    // Info about musl builds
    if (!buildMusl) {
      logger.info('')
      logger.info(
        'To build musl binaries, set BUILD_MUSL=true and re-run this script',
      )
      logger.info(
        'This will install musl-tools and gcc-aarch64-linux-gnu (for ARM64 cross-compilation)',
      )
    }

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
