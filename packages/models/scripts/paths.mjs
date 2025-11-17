/**
 * Centralized path resolution for models package.
 *
 * This is the source of truth for all build paths.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Package root: scripts/../
export const PACKAGE_ROOT = path.resolve(__dirname, '..')

// Distribution directory (output)
export const DIST_ROOT = path.join(PACKAGE_ROOT, 'dist')

/**
 * Get build directories for a specific mode (dev/prod).
 */
export function getBuildPaths(mode) {
  const buildDir = path.join(PACKAGE_ROOT, 'build', mode)
  const modelsDir = path.join(buildDir, 'models')
  const distDir = path.join(DIST_ROOT, mode)

  return {
    buildDir,
    modelsDir,
    distDir,
  }
}
