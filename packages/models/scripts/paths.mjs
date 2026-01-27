/**
 * Centralized path resolution for models package.
 *
 * This is the source of truth for all build paths.
 */

import path from 'node:path'

import { BUILD_STAGES } from 'build-infra/lib/constants'
import { createPathBuilder } from 'build-infra/lib/path-builder'

const paths = createPathBuilder(import.meta.url)

// Package root: scripts/../
export const PACKAGE_ROOT = paths.packageRoot

// Build directories
export const BUILD_ROOT = paths.buildRoot

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
 * Get build directories for a specific mode (dev/prod).
 */
export function getBuildPaths(mode) {
  const buildDir = path.join(BUILD_ROOT, mode)
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
