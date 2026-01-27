/**
 * Source extraction phase for Node.js
 *
 * Extracts Node.js source from git upstream to build directory.
 */

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'

import {
  cleanCheckpoint,
  createCheckpoint,
} from 'build-infra/lib/build-helpers'
import { printError } from 'build-infra/lib/build-output'
import {
  getCheckpointData,
  shouldRun,
} from 'build-infra/lib/checkpoint-manager'
import { CHECKPOINTS } from 'build-infra/lib/constants'

import { safeDelete, safeMkdir } from '@socketsecurity/lib/fs'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

import { UPSTREAM_PATH } from './paths.mjs'

const logger = getDefaultLogger()

/**
 * Extract Node.js source code from upstream.
 *
 * @param {object} options - Extract options
 * @param {string} options.nodeVersion - Node.js version to extract
 * @param {string} options.nodeSha - Expected commit SHA
 * @param {string} options.sharedBuildDir - Shared build directory
 * @param {string} options.sharedSourceDir - Target source directory
 * @param {string} options.packageName - Package name
 * @param {boolean} options.cleanBuild - Force clean build
 */
export async function cloneNodeSource(options) {
  const {
    cleanBuild,
    nodeSha,
    nodeVersion,
    packageName,
    sharedBuildDir,
    sharedSourceDir,
  } = options

  const needsClone = await shouldRun(
    sharedBuildDir,
    packageName,
    CHECKPOINTS.SOURCE_CLONED,
    cleanBuild,
  )

  // Check Node version mismatch
  let versionMismatch = false
  if (!needsClone) {
    const checkpointData = await getCheckpointData(
      sharedBuildDir,
      packageName,
      CHECKPOINTS.SOURCE_CLONED,
    )
    if (checkpointData && checkpointData.nodeVersion !== nodeVersion) {
      logger.log(
        `Node version changed from ${checkpointData.nodeVersion} to ${nodeVersion}, re-cloning...`,
      )
      versionMismatch = true
    } else if (checkpointData && checkpointData.nodeSha !== nodeSha) {
      logger.log(
        `Node SHA changed from ${checkpointData.nodeSha?.slice(0, 8)} to ${nodeSha.slice(0, 8)}, re-cloning...`,
      )
      versionMismatch = true
    }
  }

  if (!needsClone && !versionMismatch) {
    logger.log('')
    return
  }

  if (!existsSync(sharedSourceDir) || cleanBuild || versionMismatch) {
    if (existsSync(sharedSourceDir) && (cleanBuild || versionMismatch)) {
      logger.step('Clean Build Requested')
      logger.log('Removing existing shared Node.js source directory...')
      await safeDelete(sharedSourceDir, { recursive: true, force: true })
      await cleanCheckpoint(sharedBuildDir, packageName)
      logger.success('Cleaned shared source directory')
      logger.log('')
    }

    // Check if upstream exists in package directory.
    const upstreamPath = UPSTREAM_PATH

    if (!existsSync(upstreamPath)) {
      printError(
        'Upstream Not Initialized',
        'Node.js source upstream is not initialized.',
        [
          'Run the following command to initialize the upstream:',
          '  git submodule update --init --recursive',
          '',
          'Or if you just cloned the repository:',
          '  pnpm install',
        ],
      )
      throw new Error('Node.js source upstream not initialized')
    }

    logger.step('Extracting Node.js Source from Upstream')
    logger.log(
      `Version: ${nodeVersion}${nodeSha ? ` (${nodeSha.slice(0, 8)})` : ''}`,
    )
    logger.log(`Source: ${upstreamPath}`)
    logger.log('')
    logger.info('Copying pristine source from upstream to build directory...')
    logger.log('')

    // Verify upstream commit matches expected SHA (if SHA is provided).
    if (nodeSha) {
      const verifyResult = await spawn('git', [
        '-C',
        upstreamPath,
        'rev-parse',
        'HEAD',
      ])

      if (verifyResult.code !== 0) {
        throw new Error('Failed to verify upstream commit SHA')
      }

      const upstreamSha = verifyResult.stdout.toString().trim()
      if (upstreamSha !== nodeSha) {
        throw new Error(
          `Upstream SHA mismatch: expected ${nodeSha}, got ${upstreamSha}. ` +
            `Please update the upstream to the correct commit: cd ${upstreamPath} && git checkout ${nodeSha}`,
        )
      }

      logger.success(`Upstream SHA verified (${nodeSha.slice(0, 8)})`)
    }

    // Copy upstream to shared source directory.
    await safeMkdir(path.dirname(sharedSourceDir))
    await fs.cp(upstreamPath, sharedSourceDir, {
      recursive: true,
      force: true,
      filter: source => {
        // Skip .git directory to avoid copying upstream git metadata.
        return !source.includes('/.git')
      },
    })

    logger.success('Node.js source extracted from upstream')
    logger.log('Creating shared checkpoint (pristine source for dev/prod)...')
    await createCheckpoint(
      sharedBuildDir,
      CHECKPOINTS.SOURCE_CLONED,
      async () => {
        const configureScript = path.join(sharedSourceDir, 'configure')
        await fs.access(configureScript)
        logger.substep('Source directory validated')
      },
      {
        packageName,
        nodeVersion,
        nodeSha,
        artifactPath: sharedSourceDir,
      },
    )
    logger.log('')
  }
}
