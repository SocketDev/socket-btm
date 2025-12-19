/**
 * @fileoverview Windows build toolchain setup for node-smol-builder
 *
 * Installs required Windows system dependencies:
 * - mingw-w64 (gcc compiler)
 * - make (build system)
 *
 * Note: Using bundled OpenSSL (no extra deps)
 */

import { getLogger, getPackageRoot, install } from './shared.mjs'

export async function setup() {
  const logger = getLogger()
  logger.log('Installing Windows build dependencies...')

  const tools = ['mingw-w64', 'make']
  const { failed, installed } = await install(tools, {
    packageRoot: getPackageRoot(),
  })

  if (failed.length > 0) {
    logger.error(`Failed to install: ${failed.join(', ')}`)
    logger.info('Install manually:')
    logger.info('  choco install mingw make')
    logger.info('  -or-')
    logger.info('  scoop install mingw make')
    return false
  }

  logger.success(`Installed: ${installed.join(', ')}`)
  logger.info('Note: Using bundled OpenSSL (no extra deps)')
  return true
}
