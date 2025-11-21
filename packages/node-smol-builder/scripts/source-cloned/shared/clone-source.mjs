/**
 * Source cloning phase for Node.js
 *
 * Clones Node.js source from Git repository with retry logic and verification.
 */

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'

import {
  cleanCheckpoint,
  createCheckpoint,
  exec,
} from 'build-infra/lib/build-helpers'
import { printError } from 'build-infra/lib/build-output'
import {
  getCheckpointData,
  shouldRun,
} from 'build-infra/lib/checkpoint-manager'
import colors from 'yoctocolors-cjs'

import { safeDelete } from '@socketsecurity/lib/fs'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

const logger = getDefaultLogger()

/**
 * Clone Node.js source code.
 *
 * @param {object} options - Clone options
 * @param {string} options.nodeVersion - Node.js version to clone
 * @param {string} options.nodeSha - Expected commit SHA
 * @param {string} options.nodeRepo - Git repository URL
 * @param {string} options.sharedBuildDir - Shared build directory
 * @param {string} options.sharedSourceDir - Target source directory
 * @param {string} options.packageName - Package name
 * @param {string} options.packageRoot - Package root directory
 * @param {boolean} options.cleanBuild - Force clean build
 */
export async function cloneNodeSource(options) {
  const {
    cleanBuild,
    nodeRepo,
    nodeSha,
    nodeVersion,
    packageName,
    packageRoot,
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

    logger.step('Cloning Node.js Source')
    logger.log(`Version: ${nodeVersion} (${nodeSha.slice(0, 8)})`)
    logger.log(`Repository: ${nodeRepo}`)
    logger.log('')
    logger.info(
      'This will download ~200-300 MB (shallow clone with --depth=1 --single-branch)...',
    )
    logger.log('Retry: Up to 3 attempts if clone fails')
    logger.log('')

    // Git clone with retry
    let cloneSuccess = false
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        if (attempt > 1) {
          logger.log(`Retry attempt ${attempt}/3...`)
          logger.log('')
        }

        await exec(
          'git',
          [
            'clone',
            '--depth',
            '1',
            '--single-branch',
            '--branch',
            nodeVersion,
            nodeRepo,
            sharedSourceDir,
          ],
          { cwd: packageRoot },
        )
        cloneSuccess = true
        break
      } catch (e) {
        if (attempt === 3) {
          printError(
            'Git Clone Failed',
            `Failed to clone Node.js repository after 3 attempts: ${e.message}`,
            [
              'Check your internet connection',
              'Try again in a few minutes',
              'Manually clone:',
              `  cd ${packageRoot}`,
              `  git clone --depth 1 --branch ${nodeVersion} ${nodeRepo} ${sharedSourceDir}`,
            ],
          )
          throw new Error('Git clone failed after retries')
        }

        logger.warn(
          `${colors.yellow('⚠')} Clone attempt ${attempt} failed: ${e.message}`,
        )

        // Clean up partial clone
        try {
          await safeDelete(sharedSourceDir, {
            recursive: true,
            force: true,
          })
        } catch {
          // Ignore cleanup errors
        }

        // Wait before retry
        const waitTime = 2000 * attempt
        logger.log(`${colors.blue('ℹ')} Waiting ${waitTime}ms before retry...`)
        logger.log('')
        await new Promise(resolve => setTimeout(resolve, waitTime))
      }
    }

    if (cloneSuccess) {
      logger.success('Node.js source cloned successfully')

      // Verify the cloned commit matches the expected SHA
      logger.log('Verifying commit SHA...')
      const verifyResult = await spawn('git', [
        '-C',
        sharedSourceDir,
        'rev-parse',
        'HEAD',
      ])

      if (verifyResult.code !== 0) {
        throw new Error('Failed to verify cloned commit SHA')
      }

      const clonedSha = verifyResult.stdout.toString().trim()
      if (clonedSha !== nodeSha) {
        throw new Error(
          `SHA mismatch: expected ${nodeSha}, got ${clonedSha}. ` +
            `The tag ${nodeVersion} may have been updated. Please update sources.node.ref in package.json.`,
        )
      }

      logger.success(`Commit SHA verified (${nodeSha.slice(0, 8)})`)
      logger.log('Creating shared checkpoint (pristine source for dev/prod)...')
      await createCheckpoint(
        sharedBuildDir,
        packageName,
        'source-cloned',
        async () => {
          const configureScript = path.join(sharedSourceDir, 'configure')
          await fs.access(configureScript)
          logger.substep('Source directory validated')
        },
        {
          nodeVersion,
          nodeSha,
          artifactPath: sharedSourceDir,
        },
      )
      logger.log('')
    }
  }
}
