/**
 * @fileoverview macOS build toolchain setup for binject
 *
 * Installs required macOS system dependencies:
 * - clang (Xcode Command Line Tools)
 * - cmake (for LIEF library)
 * - make (for build system)
 *
 * Note: Compression via system Compression framework (no extra deps)
 */

import { getLogger, getPackageRoot, install } from './shared.mjs'

export async function setup() {
  const logger = getLogger()
  logger.log('Installing macOS build dependencies...')

  const tools = ['clang', 'cmake', 'make']
  const { failed, installed } = await install(tools, {
    packageRoot: getPackageRoot(),
    skipVersionPin: true,
  })

  if (failed.length > 0) {
    logger.warn(`Failed to install: ${failed.join(', ')}`)
    logger.info('Install manually:')
    logger.info('  xcode-select --install  # For clang/clang++')
    logger.info('  brew install cmake make')
    return false
  }

  logger.success(`Installed: ${installed.join(', ')}`)
  logger.info(
    'Note: Compression via system Compression framework (no extra deps)',
  )
  return true
}
