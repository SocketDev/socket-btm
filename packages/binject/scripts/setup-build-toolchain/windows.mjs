/**
 * @fileoverview Windows build toolchain setup for binject
 *
 * Installs required Windows system dependencies:
 * - mingw-w64 (gcc/g++ compilers)
 * - cmake (for LIEF library)
 * - make (build system)
 *
 * Note: Compression via Cabinet API (no extra deps)
 */

import { getLogger, getPackageRoot, install } from './shared.mjs'

export async function setup() {
  const logger = getLogger()
  logger.log('Installing Windows build dependencies...')

  const tools = ['mingw-w64', 'cmake', 'make']
  const { failed, installed } = await install(tools, {
    packageRoot: getPackageRoot(),
  })

  if (failed.length > 0) {
    logger.error(`Failed to install: ${failed.join(', ')}`)
    logger.info('Install manually:')
    logger.info('  choco install mingw cmake make')
    logger.info('  -or-')
    logger.info('  scoop install mingw cmake make')
    return false
  }

  logger.success(`Installed: ${installed.join(', ')}`)
  logger.info('Note: Compression via Cabinet API (no extra deps)')
  return true
}
