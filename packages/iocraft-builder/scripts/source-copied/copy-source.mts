/**
 * Copy pristine iocraft source from upstream submodule.
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
 * Copy iocraft source from upstream to shared build directory.
 * @returns {Promise<void>}
 */
export async function copySource() {
  const { buildDir, checkpointsDir, sourceCopiedDir } = getSharedBuildPaths()

  logger.info('Copying iocraft source from upstream...')

  await safeMkdir(sourceCopiedDir, { recursive: true })

  await fs.cp(UPSTREAM_PATH, sourceCopiedDir, {
    filter: source => {
      return !source.includes('/.git')
    },
    force: true,
    recursive: true,
  })

  logger.success('iocraft source copied')

  await createCheckpoint(
    buildDir,
    CHECKPOINTS.SOURCE_COPIED,
    async () => {
      const cargoToml = await fs.readFile(
        path.join(sourceCopiedDir, 'Cargo.toml'),
        'utf8',
      )
      if (!cargoToml.includes('[package]')) {
        throw new Error('Invalid iocraft source: missing Cargo.toml [package]')
      }
    },
    { artifactPath: sourceCopiedDir },
  )
}
