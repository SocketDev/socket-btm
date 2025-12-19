/**
 * @fileoverview macOS build toolchain setup for node-smol-builder
 *
 * Installs required macOS system dependencies:
 * - clang (Xcode Command Line Tools)
 * - make (for build system)
 * - openssl@3 (for stub binary)
 */

import { getLogger, getPackageRoot, install } from './shared.mjs'

export async function setup() {
  const logger = getLogger()
  logger.log('Installing macOS build dependencies...')

  const tools = ['clang', 'make', 'openssl@3']
  const { failed, installed } = await install(tools, {
    packageRoot: getPackageRoot(),
    skipVersionPin: true,
  })

  if (failed.length > 0) {
    logger.warn(`Failed to install: ${failed.join(', ')}`)
    logger.info('Install manually:')
    logger.info('  xcode-select --install  # For clang')
    logger.info('  brew install make openssl@3')
    return false
  }

  logger.success(`Installed: ${installed.join(', ')}`)
  return true
}
