/**
 * Apply patches to OpenTUI source and inject build files.
 * Creates SOURCE_PATCHED checkpoint.
 */

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'

import { createCheckpoint } from 'build-infra/lib/checkpoint-manager'
import { CHECKPOINTS } from 'build-infra/lib/constants'
import { applyPatchDirectory } from 'build-infra/lib/patch-validator'

import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { safeMkdir } from '@socketsecurity/lib/fs'

import {
  BUILD_ZIG,
  BUILD_ZIG_ZON,
  PACKAGE_ROOT,
  SRC_DIR,
  VENDOR_DIR,
  getBuildPaths,
  getSharedBuildPaths,
} from '../paths.mts'

const logger = getDefaultLogger()

/**
 * Apply patches to OpenTUI source and inject our build files.
 * @param {string} platformArch - Platform-arch identifier
 * @param {string} buildMode - Build mode ('dev' or 'prod')
 * @returns {Promise<void>}
 */
export async function applyPatches(platformArch, buildMode) {
  if (!buildMode) {
    throw new Error('applyPatches requires buildMode parameter')
  }
  const { sourceCopiedDir } = getSharedBuildPaths()
  const { buildDir, sourcePatchedDir } = getBuildPaths(buildMode, platformArch)
  const patchesDir = path.join(PACKAGE_ROOT, 'patches')

  logger.info('Applying OpenTUI patches...')

  await safeMkdir(sourcePatchedDir, { recursive: true })

  // Copy pristine source to patched directory
  await fs.cp(sourceCopiedDir, sourcePatchedDir, {
    force: true,
    recursive: true,
  })

  // Apply any upstream patches
  if (existsSync(patchesDir)) {
    logger.info(`Applying patches from ${patchesDir}...`)
    await applyPatchDirectory(patchesDir, sourcePatchedDir, { validate: true })
    logger.success('All OpenTUI patches applied')
  } else {
    logger.info('No patches directory found, skipping')
  }

  // Inject our build files into the patched source
  logger.info('Copying build files to patched source...')

  // Copy our wrapper build.zig (replaces upstream build.zig)
  await fs.copyFile(BUILD_ZIG, path.join(sourcePatchedDir, 'build.zig'))

  // Copy build.zig.zon
  await fs.copyFile(BUILD_ZIG_ZON, path.join(sourcePatchedDir, 'build.zig.zon'))

  // Copy our Zig source files (node-api bindings)
  await fs.cp(SRC_DIR, path.join(sourcePatchedDir, 'src'), {
    force: true,
    recursive: true,
  })

  // Copy vendored node-api headers
  const vendorDest = path.join(sourcePatchedDir, 'vendor')
  await safeMkdir(vendorDest, { recursive: true })
  await fs.cp(VENDOR_DIR, vendorDest, {
    force: true,
    recursive: true,
  })

  logger.success('Build files copied')

  await createCheckpoint(
    buildDir,
    CHECKPOINTS.SOURCE_PATCHED,
    async () => {
      const buildZig = path.join(sourcePatchedDir, 'build.zig')
      const content = await fs.readFile(buildZig, 'utf8')
      if (!content.includes('node_api_entry')) {
        throw new Error(
          'Invalid patched source: build.zig missing node_api_entry reference',
        )
      }
    },
    { artifactPath: sourcePatchedDir },
  )
}
