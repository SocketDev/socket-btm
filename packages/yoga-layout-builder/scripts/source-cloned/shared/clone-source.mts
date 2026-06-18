/**
 * Source cloning phase for Yoga Layout
 *
 * Clones Yoga Layout source from Git repository with SHA verification.
 */

import { existsSync } from 'node:fs'
import path from 'node:path'

import { WIN32 } from '@socketsecurity/lib-stable/constants/platform'
import { safeMkdir } from '@socketsecurity/lib-stable/fs/safe'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import {
  generateEnumsFile,
  stampWrapAssemblyVersion,
} from './generate-enums.mts'
import { PACKAGE_ROOT } from '../../paths.mts'

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
 */
export async function cloneYogaSource(options) {
  const { sharedBuildDir, sharedSourceDir, yogaRepo, yogaSha, yogaVersion } =
    options

  // Check if source already exists.
  if (existsSync(sharedSourceDir)) {
    const cmakeLists = path.join(sharedSourceDir, 'CMakeLists.txt')
    if (existsSync(cmakeLists)) {
      logger.substep('Yoga source already exists, skipping clone')
      await regenerateEnums(sharedSourceDir, yogaVersion)
      return {
        artifactPath: sharedSourceDir,
        smokeTest: async () => {
          if (!existsSync(path.join(sharedSourceDir, 'CMakeLists.txt'))) {
            throw new Error(`Cloned source missing: ${sharedSourceDir}`)
          }
        },
      }
    }
  }

  await safeMkdir(sharedBuildDir)

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

  await regenerateEnums(sharedSourceDir, yogaVersion)

  return {
    artifactPath: sharedSourceDir,
    smokeTest: async () => {
      if (!existsSync(path.join(sharedSourceDir, 'CMakeLists.txt'))) {
        throw new Error(`Cloned source missing: ${sharedSourceDir}`)
      }
    },
  }
}

/**
 * Regenerate src/wrapper/YGEnums.mts from the cloned yoga header AND re-stamp
 * the yoga version in wrapAssembly.mts's Lock-step marker, both from the
 * build-verified `yogaVersion`. The enum mirror can never drift from the
 * binary's ABI (both come from this same checkout), and the wrapper's
 * provenance comment can never silently lie about which yoga it tracks. Runs
 * on every clone-source invocation, including the already-cloned fast path.
 */
export async function regenerateEnums(
  sharedSourceDir: string,
  yogaVersion: string,
): Promise<void> {
  const headerPath = path.join(sharedSourceDir, 'yoga', 'YGEnums.h')
  if (!existsSync(headerPath)) {
    throw new Error(`Yoga enum header missing: ${headerPath}`)
  }
  const wrapperDir = path.join(PACKAGE_ROOT, 'src', 'wrapper')
  await generateEnumsFile(
    headerPath,
    path.join(wrapperDir, 'YGEnums.mts'),
    yogaVersion,
  )
  logger.substep(`Regenerated YGEnums.mts from yoga/YGEnums.h (${yogaVersion})`)
  const stamped = await stampWrapAssemblyVersion(
    path.join(wrapperDir, 'wrapAssembly.mts'),
    yogaVersion,
  )
  if (stamped) {
    logger.substep(
      `Re-stamped wrapAssembly.mts Lock-step → yoga ${yogaVersion}`,
    )
  }
}
