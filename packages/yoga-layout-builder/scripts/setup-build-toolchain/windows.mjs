/**
 * @fileoverview Windows build toolchain setup for yoga-layout-builder
 *
 * Installs required Windows system dependencies:
 * - mingw-w64 (gcc/g++ compilers)
 * - make (build system)
 * - cmake (for Yoga Layout build)
 * - python3 (for build scripts)
 *
 * Note: emscripten (WASM compiler) is installed via emsdk during build
 */

import {
  getLogger,
  getPackageRoot,
  install,
  logEmscriptenInfo,
} from './shared.mjs'

export async function setup() {
  const logger = getLogger()
  logger.log('Installing Windows build dependencies...')

  const tools = ['mingw-w64', 'make', 'cmake', 'python3']
  const { failed, installed } = await install(tools, {
    packageRoot: getPackageRoot(),
  })

  if (failed.length > 0) {
    logger.error(`Failed to install: ${failed.join(', ')}`)
    logger.info('Install manually:')
    logger.info('  choco install mingw cmake python make')
    logger.info('  -or-')
    logger.info('  scoop install mingw cmake python make')
    return false
  }

  logger.success(`Installed: ${installed.join(', ')}`)
  logEmscriptenInfo()
  return true
}
