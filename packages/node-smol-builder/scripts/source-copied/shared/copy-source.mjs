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
    CHECKPOINTS.SOURCE_COPIED,
    cleanBuild,
  )

  // Check Node version mismatch
  let versionMismatch = false
  if (!needsClone) {
    const checkpointData = await getCheckpointData(
      sharedBuildDir,
      packageName,
      CHECKPOINTS.SOURCE_COPIED,
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

  // Handle three cases:
  // 1. Source dir doesn't exist: copy from upstream and create checkpoint
  // 2. Clean build or version mismatch: delete, re-copy, and create checkpoint
  // 3. Source dir exists but checkpoint missing: validate and create checkpoint
  if (!existsSync(sharedSourceDir) || cleanBuild || versionMismatch) {
    if (existsSync(sharedSourceDir) && (cleanBuild || versionMismatch)) {
      logger.step('Clean Build Requested')
      logger.log('Removing existing shared Node.js source directory...')
      await safeDelete(sharedSourceDir, { force: true, recursive: true })
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
    logger.substep(
      `Version: ${nodeVersion}${nodeSha ? ` (${nodeSha.slice(0, 8)})` : ''}`,
    )
    logger.substep(`Source: ${upstreamPath}`)
    logger.log('')
    logger.info('Copying pristine source from upstream to build directory...')
    logger.log('')

    // Verify upstream commit matches expected SHA (if SHA is provided).
    if (nodeSha) {
      const verifyResult = await spawn(
        'git',
        ['-C', upstreamPath, 'rev-parse', 'HEAD'],
        { stdio: 'pipe' },
      )

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
      filter: source => {
        // Skip .git directory to avoid copying upstream git metadata.
        return !source.includes('/.git')
      },
      force: true,
      recursive: true,
    })

    logger.success('Node.js source extracted from upstream')
    logger.log('Creating shared checkpoint (pristine source for dev/prod)...')
    await createCheckpoint(
      sharedBuildDir,
      CHECKPOINTS.SOURCE_COPIED,
      async () => {
        const configureScript = path.join(sharedSourceDir, 'configure')
        if (!existsSync(configureScript)) {
          throw new Error(`Configure script not found: ${configureScript}`)
        }
        logger.substep('Source directory validated')
      },
      {
        artifactPath: sharedSourceDir,
        nodeSha,
        nodeVersion,
        packageName,
      },
    )
    logger.log('')
  } else if (needsClone && existsSync(sharedSourceDir)) {
    // Case 3: Source dir exists but checkpoint is missing.
    // Validate the existing source and create checkpoint.
    logger.step('Recovering Missing Checkpoint')
    logger.substep('Source directory exists but checkpoint is missing')
    logger.log('')
    logger.info('Validating existing source directory...')

    const configureScript = path.join(sharedSourceDir, 'configure')
    if (!existsSync(configureScript)) {
      // Source directory is invalid, need to re-copy from upstream
      logger.warn(
        'Existing source directory is invalid (missing configure script)',
      )
      logger.info('Will re-copy from upstream...')
      await safeDelete(sharedSourceDir, { force: true, recursive: true })

      // Recursively call to handle the fresh clone
      await cloneNodeSource(options)
      return
    }

    logger.success('Existing source directory is valid')
    logger.log('Creating checkpoint from existing source...')

    await createCheckpoint(
      sharedBuildDir,
      CHECKPOINTS.SOURCE_COPIED,
      async () => {
        logger.substep('Source directory validated')
      },
      {
        artifactPath: sharedSourceDir,
        nodeSha,
        nodeVersion,
        packageName,
      },
    )
    logger.log('')
  }
}
