/**
 * @fileoverview Linux build toolchain setup for node-smol-builder
 *
 * Installs required Linux system dependencies:
 * - gcc (C compiler)
 * - make (build system)
 * - liblzma-dev (for stub binary)
 * - libssl-dev (for stub binary)
 * - musl-tools (for musl builds, optional)
 * - gcc-aarch64-linux-gnu (for ARM64 cross-compilation, optional)
 */

import {
  getArch,
  getLogger,
  getPackageRoot,
  install,
  isBuildMusl,
  updateCache,
} from './shared.mjs'

export async function setup() {
  const logger = getLogger()
  logger.log('Installing Linux build dependencies...')
  updateCache()

  // Base dependencies for all Linux builds
  const tools = ['gcc', 'make', 'liblzma-dev', 'libssl-dev']

  // If building musl binaries, add musl toolchain
  // Note: This auto-detects based on current architecture
  // For cross-compilation, users need to manually install
  const buildMusl = isBuildMusl()
  if (buildMusl) {
    logger.log('Detected musl build - adding musl toolchain...')
    tools.push('musl-tools')

    // Add ARM64 cross-compiler if on x64
    if (getArch() === 'x64') {
      tools.push('gcc-aarch64-linux-gnu')
    }
  }

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
