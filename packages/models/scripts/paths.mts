/**
 * Centralized path resolution for models package.
 *
 * This is the source of truth for all build paths.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { BUILD_STAGES } from 'build-infra/lib/constants'
import { getCurrentPlatformArch } from 'build-infra/lib/platform-mappings'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Package root: scripts/../
export const PACKAGE_ROOT = path.resolve(__dirname, '..')

// Build directories
export const BUILD_ROOT = path.join(PACKAGE_ROOT, 'build')

/**
 * Get shared build directories for models (shared across dev/prod).
 */
export function getSharedBuildPaths() {
  const buildDir = path.join(BUILD_ROOT, 'shared')
  // Models are downloaded to centralized location: ../build-infra/build/downloaded/models/{modelKey}/
  const modelsDir = path.join(
    PACKAGE_ROOT,
    '..',
    'build-infra',
    'build',
    'downloaded',
    'models',
  )
  const checkpointsDir = path.join(buildDir, 'checkpoints')

  return {
    buildDir,
    checkpointsDir,
    modelsDir,
  }
}

/**
 * Get build directories for a specific mode (dev/prod) with REQUIRED platformArch.
 * @param {string} mode - Build mode ('dev' or 'prod')
 * @param {string} platformArch - Platform-arch (e.g., 'darwin-arm64') - REQUIRED
 */
export function getBuildPaths(mode, platformArch) {
  if (!platformArch) {
    throw new Error('platformArch is required for getBuildPaths()')
  }

  const buildDir = path.join(BUILD_ROOT, mode, platformArch)
  // Models are downloaded to centralized location: ../build-infra/build/downloaded/models/{modelKey}/
  const modelsDir = path.join(
    PACKAGE_ROOT,
    '..',
    'build-infra',
    'build',
    'downloaded',
    'models',
  )
  const checkpointsDir = path.join(buildDir, 'checkpoints')

  // Output directories (aligned with checkpoint names)
  const outDir = path.join(buildDir, 'out')
  const outputReleaseDir = path.join(outDir, BUILD_STAGES.RELEASE)
  const outputFinalDir = path.join(outDir, BUILD_STAGES.FINAL)

  return {
    buildDir,
    checkpointsDir,
    modelsDir,
    outDir,
    outputFinalDir,
    outputReleaseDir,
  }
}

/**
 * Get the current platform identifier using shared utility.
 * Handles musl detection and respects TARGET_ARCH environment variable.
 */
export async function getCurrentPlatform() {
  return await getCurrentPlatformArch()
}
