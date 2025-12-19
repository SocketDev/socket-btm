/**
 * @fileoverview macOS build toolchain setup for onnxruntime-builder
 *
 * Installs required macOS system dependencies:
 * - clang (Xcode Command Line Tools)
 * - make (for build system)
 * - cmake (for ONNX Runtime build)
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
  logger.log('Installing macOS build dependencies...')

  const tools = ['clang', 'make', 'cmake', 'python3']
  const { failed, installed } = await install(tools, {
    packageRoot: getPackageRoot(),
    skipVersionPin: true,
  })

  if (failed.length > 0) {
    logger.error(`Failed to install: ${failed.join(', ')}`)
    logger.info('Install manually:')
    logger.info('  xcode-select --install  # For clang/clang++')
    logger.info('  brew install cmake python3 make')
    return false
  }

  logger.success(`Installed: ${installed.join(', ')}`)
  logEmscriptenInfo()
  return true
}
