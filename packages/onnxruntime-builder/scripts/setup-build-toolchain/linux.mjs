/**
 * @fileoverview Linux build toolchain setup for onnxruntime-builder
 *
 * Installs required Linux system dependencies:
 * - gcc (C compiler)
 * - make (build system)
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
  updateCache,
} from './shared.mjs'

export async function setup() {
  const logger = getLogger()
  logger.log('Installing Linux build dependencies...')
  updateCache()

  const tools = ['gcc', 'make', 'cmake', 'python3']
  const { failed, installed } = await install(tools, {
    packageRoot: getPackageRoot(),
  })

  if (failed.length > 0) {
    logger.error(`Failed to install: ${failed.join(', ')}`)
    logger.info(
      'You may need to install these manually. See packages/build-infra/docs/prerequisites.md',
    )
    return false
  }

  logger.success(`Installed: ${installed.join(', ')}`)
  logEmscriptenInfo()
  return true
}
