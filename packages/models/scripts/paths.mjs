/**
 * Centralized path resolution for models package.
 *
 * This is the source of truth for all build paths.
 */

import { createPathBuilder } from 'build-infra/lib/path-builder'

const paths = createPathBuilder(import.meta.url)

// Package root: scripts/../
export const PACKAGE_ROOT = paths.packageRoot

// Distribution directory (output)
export const DIST_ROOT = paths.distRoot

/**
 * Get build directories for a specific mode (dev/prod).
 */
export function getBuildPaths(mode) {
  return paths.modelPaths(mode)
}
