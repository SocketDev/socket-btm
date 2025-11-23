/**
 * @fileoverview macOS build toolchain setup for binflate
 *
 * Installs required macOS system dependencies:
 * - clang (Xcode Command Line Tools)
 * - make (for build system)
 *
 * Note: Decompression via system Compression framework (no extra deps)
 */

import { getLogger, getPackageRoot, install } from './shared.mjs'

export async function setup() {
  const logger = getLogger()
  logger.log('Installing macOS build dependencies...')

  const tools = ['clang', 'make']
  const { failed, installed } = await install(tools, {
    packageRoot: getPackageRoot(),
    skipVersionPin: true,
  })

  if (failed.length > 0) {
    logger.warn(`Failed to install: ${failed.join(', ')}`)
    logger.info('Install manually:')
    logger.info('  xcode-select --install  # For clang')
    logger.info('  brew install make')
    return false
  }

  logger.success(`Installed: ${installed.join(', ')}`)
  logger.info(
    'Note: Decompression via system Compression framework (no extra deps)',
  )
  return true
}
