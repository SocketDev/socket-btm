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

export const ADDITIONS_SOURCE_PATCHED_JS_DIR = path.join(
  ADDITIONS_SOURCE_PATCHED_DIR,
  'js',
)

export const ADDITIONS_SOURCE_PATCHED_POLYFILLS_DIR = path.join(
  ADDITIONS_SOURCE_PATCHED_JS_DIR,
  'polyfills',
)

export const ADDITIONS_SOURCE_PATCHED_VFS_DIR = path.join(
  ADDITIONS_SOURCE_PATCHED_JS_DIR,
  'vfs',
)

export const ADDITIONS_SOURCE_PATCHED_SMOL_DIR = path.join(
  ADDITIONS_SOURCE_PATCHED_JS_DIR,
  'smol',
)

export const ADDITIONS_SOURCE_PATCHED_CPP_DIR = path.join(
  ADDITIONS_SOURCE_PATCHED_DIR,
  'cpp',
)

export const ADDITIONS_SOURCE_PATCHED_VFS_CPP_DIR = path.join(
  ADDITIONS_SOURCE_PATCHED_CPP_DIR,
  'vfs',
)

export const ADDITIONS_MAPPINGS = [
  {
    source: ADDITIONS_SOURCE_PATCHED_POLYFILLS_DIR,
    dest: 'lib/internal/socketsecurity_polyfills',
  },
  {
    source: ADDITIONS_SOURCE_PATCHED_VFS_DIR,
    dest: 'lib/internal/socketsecurity_vfs',
  },
  {
    source: ADDITIONS_SOURCE_PATCHED_SMOL_DIR,
    dest: 'lib/internal/socketsecurity_smol',
  },
  {
    source: ADDITIONS_SOURCE_PATCHED_VFS_CPP_DIR,
    dest: 'src',
  },
]
