/**
 * Source cloning phase for Yoga Layout
 *
 * Clones Yoga Layout source from Git repository with SHA verification.
 */

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'

import { createCheckpoint, shouldRun } from 'build-infra/lib/checkpoint-manager'

import { WIN32 } from '@socketsecurity/lib/constants/platform'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

const logger = getDefaultLogger()

/**
 * Clone Yoga Layout source code.
 *
 * @param {object} options - Clone options
 * @param {string} options.yogaVersion - Yoga version to clone (e.g., 'v3.1.0')
 * @param {string} options.yogaSha - Expected commit SHA
 * @param {string} options.yogaRepo - Git repository URL
 * @param {string} options.sharedBuildDir - Shared build directory
 * @param {string} options.sharedSourceDir - Target source directory
 * @param {boolean} options.forceRebuild - Force rebuild (ignore checkpoints)
 */
export async function cloneYogaSource(options) {
  const {
    forceRebuild,
    sharedBuildDir,
    sharedSourceDir,
    yogaRepo,
    yogaSha,
    yogaVersion,
  } = options

  if (!(await shouldRun(sharedBuildDir, '', 'source-cloned', forceRebuild))) {
    return
  }

  logger.step('Cloning Yoga Source')

  if (existsSync(sharedSourceDir)) {
    logger.substep('Yoga source already exists, skipping clone')
    await createCheckpoint(
      sharedBuildDir,
      '',
      'source-cloned',
      async () => {
        // Smoke test: Verify source directory exists with CMakeLists.txt
        const cmakeLists = path.join(sharedSourceDir, 'CMakeLists.txt')
        await fs.access(cmakeLists)
        logger.substep('Source directory validated')
      },
      {
        yogaVersion,
        yogaSha,
        artifactPath: sharedSourceDir,
      },
    )
    return
  }

  await fs.mkdir(sharedBuildDir, { recursive: true })

  logger.substep(`Cloning Yoga ${yogaVersion} (${yogaSha.slice(0, 8)})...`)

  // Clone using commit SHA for immutability.
  // We use the version tag with --branch for efficiency (works with --depth 1).
  const cloneResult = await spawn(
    'git',
    [
      'clone',
      '--depth',
      '1',
      '--single-branch',
      '--branch',
      yogaVersion,
      yogaRepo,
      sharedSourceDir,
    ],
    {
      shell: WIN32,
      stdio: 'inherit',
    },
  )

  if (cloneResult.code !== 0) {
    throw new Error('Failed to clone Yoga repository')
  }

  // Verify the cloned commit matches the expected SHA.
  const verifyResult = await spawn(
    'git',
    ['-C', sharedSourceDir, 'rev-parse', 'HEAD'],
    {
      shell: WIN32,
    },
  )

  if (verifyResult.code !== 0) {
    throw new Error('Failed to verify cloned commit SHA')
  }

  const clonedSha = verifyResult.stdout.toString().trim()
  if (clonedSha !== yogaSha) {
    throw new Error(
      `SHA mismatch: expected ${yogaSha}, got ${clonedSha}. ` +
        `The tag ${yogaVersion} may have been updated. Please update sources.yoga.ref in package.json.`,
    )
  }

  logger.success(
    `Yoga ${yogaVersion} cloned and verified (${yogaSha.slice(0, 8)})`,
  )

  await createCheckpoint(
    sharedBuildDir,
    '',
    'source-cloned',
    async () => {
      // Smoke test: Verify source directory exists with CMakeLists.txt
      const cmakeLists = path.join(sharedSourceDir, 'CMakeLists.txt')
      await fs.access(cmakeLists)
      logger.substep('Source directory validated')
    },
    {
      yogaVersion,
      yogaSha,
      artifactPath: sharedSourceDir,
    },
  )
}
