/**
 * Source extraction phase for Node.js
 *
 * Extracts Node.js source from git submodule to build directory.
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

import { safeDelete, safeMkdir } from '@socketsecurity/lib/fs'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

import { SUBMODULE_PATH } from './paths.mjs'

const logger = getDefaultLogger()

/**
 * Extract Node.js source code from submodule.
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
    'source-cloned',
    cleanBuild,
  )

  // Check Node version mismatch
  let versionMismatch = false
  if (!needsClone) {
    const checkpointData = await getCheckpointData(
      sharedBuildDir,
      packageName,
      'source-cloned',
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

    // Check if submodule exists in package directory.
    const submodulePath = SUBMODULE_PATH

    if (!existsSync(submodulePath)) {
      printError(
        'Submodule Not Initialized',
        'Node.js source submodule is not initialized.',
        [
          'Run the following command to initialize the submodule:',
          '  git submodule update --init --recursive',
          '',
          'Or if you just cloned the repository:',
          '  pnpm install',
        ],
      )
      throw new Error('Node.js source submodule not initialized')
    }

    logger.step('Extracting Node.js Source from Submodule')
    logger.log(`Version: ${nodeVersion} (${nodeSha.slice(0, 8)})`)
    logger.log(`Source: ${submodulePath}`)
    logger.log('')
    logger.info('Copying pristine source from submodule to build directory...')
    logger.log('')

    // Verify submodule commit matches expected SHA.
    const verifyResult = await spawn('git', [
      '-C',
      submodulePath,
      'rev-parse',
      'HEAD',
    ])

    if (verifyResult.code !== 0) {
      throw new Error('Failed to verify submodule commit SHA')
    }

    const submoduleSha = verifyResult.stdout.toString().trim()
    if (submoduleSha !== nodeSha) {
      throw new Error(
        `Submodule SHA mismatch: expected ${nodeSha}, got ${submoduleSha}. ` +
          `Please update the submodule to the correct commit: cd ${submodulePath} && git checkout ${nodeSha}`,
      )
    }

    logger.success(`Submodule SHA verified (${nodeSha.slice(0, 8)})`)

    // Copy submodule to shared source directory.
    await safeMkdir(path.dirname(sharedSourceDir))
    await fs.cp(submodulePath, sharedSourceDir, {
      recursive: true,
      force: true,
      filter: source => {
        // Skip .git directory to avoid copying submodule git metadata.
        return !source.includes('/.git')
      },
    })

    logger.success('Node.js source extracted from submodule')
    logger.log('Creating shared checkpoint (pristine source for dev/prod)...')
    await createCheckpoint(
      sharedBuildDir,
      'source-cloned',
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
