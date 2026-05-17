/**
 * Copy pristine OpenTUI source from upstream submodule.
 * Creates SOURCE_COPIED checkpoint.
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'

import { createCheckpoint } from 'build-infra/lib/checkpoint-manager'
import { CHECKPOINTS } from 'build-infra/lib/constants'

import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { safeMkdir } from '@socketsecurity/lib/fs'

import { UPSTREAM_PATH, getSharedBuildPaths } from '../paths.mts'

const logger = getDefaultLogger()

/**
 * Copy OpenTUI Zig source from upstream to shared build directory.
 * We copy only the Zig core (packages/core/src/zig/) since that's what we build.
 * @returns {Promise<void>}
 */
export async function copySource() {
  const { buildDir, sourceCopiedDir } = getSharedBuildPaths()

  logger.info('Copying OpenTUI source from upstream...')

  await safeMkdir(sourceCopiedDir, { recursive: true })

  // Copy the Zig core source directory
  const zigSourceDir = path.join(
    UPSTREAM_PATH,
    'packages',
    'core',
    'src',
    'zig',
  )

  await fs.cp(zigSourceDir, sourceCopiedDir, {
    filter: source => {
      return !source.includes('/.git')
    },
    force: true,
    recursive: true,
  })

  logger.success('OpenTUI source copied')

  await createCheckpoint(
    buildDir,
    CHECKPOINTS.SOURCE_COPIED,
    async () => {
      const buildZig = path.join(sourceCopiedDir, 'build.zig')
      const content = await fs.readFile(buildZig, 'utf8')
      if (!content.includes('pub fn build')) {
        throw new Error(
          'Invalid OpenTUI source: missing build.zig with build function',
        )
      }
    },
    { artifactPath: sourceCopiedDir },
  )
}
