/**
 * Paths used by binary-released checkpoint scripts.
 *
 * Re-exports infrastructure paths from root, and defines checkpoint-specific paths.
 */

import path from 'node:path'

import {
  PACKAGE_ROOT,
  getBuildPaths,
  getSharedBuildPaths,
} from '../../paths.mjs'

// Re-export infrastructure paths
export { PACKAGE_ROOT, getBuildPaths, getSharedBuildPaths }

// Checkpoint-specific paths (defined here, not in root paths.mjs)
export const PATCHES_RELEASE_DIR = path.join(
  PACKAGE_ROOT,
  'patches',
  'release',
  'shared',
)

export const ADDITIONS_RELEASE_DIR = path.join(
  PACKAGE_ROOT,
  'additions',
  'release',
  'shared',
)

export const ADDITIONS_RELEASE_POLYFILLS_DIR = path.join(
  ADDITIONS_RELEASE_DIR,
  'polyfills',
)

export const ADDITIONS_MAPPINGS = [
  {
    source: ADDITIONS_RELEASE_POLYFILLS_DIR,
    dest: 'lib/internal/socketsecurity_polyfills',
  },
]

export const COMPRESSION_TOOLS_DIR = path.join(
  PACKAGE_ROOT,
  'compression-tools',
)
