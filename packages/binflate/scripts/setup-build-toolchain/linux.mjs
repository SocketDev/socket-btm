/**
 * @fileoverview Linux build toolchain setup for binflate
 *
 * Installs required Linux system dependencies:
 * - gcc (C compiler)
 * - make (build system)
 * - liblzma-dev (for LZMA decompression)
 */

import { getLogger, getPackageRoot, install, updateCache } from './shared.mjs'

export async function setup() {
  const logger = getLogger()
  logger.log('Installing Linux build dependencies...')
  updateCache()

  const tools = ['gcc', 'make', 'liblzma-dev']
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
  return true
}
