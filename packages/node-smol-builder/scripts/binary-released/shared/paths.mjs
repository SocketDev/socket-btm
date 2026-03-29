/**
 * Paths used by binary-released checkpoint scripts.
 *
 * Re-exports infrastructure paths from root, and defines checkpoint-specific paths.
 */

import path from 'node:path'

import {
  BINFLATE_DIR,
  BINPRESS_DIR,
  PACKAGE_ROOT,
  getBuildPaths,
  getSharedBuildPaths,
} from '../../paths.mjs'

// Re-export infrastructure paths
export {
  BINFLATE_DIR,
  BINPRESS_DIR,
  PACKAGE_ROOT,
  getBuildPaths,
  getSharedBuildPaths,
}

// Checkpoint-specific paths (defined here, not in root paths.mjs)
// Note: Using 'source-patched' checkpoint name (aligned with createCheckpoint calls)
export const PATCHES_SOURCE_PATCHED_DIR = path.join(
  PACKAGE_ROOT,
  'patches',
  'source-patched',
)

export const ADDITIONS_SOURCE_PATCHED_DIR = path.join(
  PACKAGE_ROOT,
  'additions',
  'source-patched',
)
