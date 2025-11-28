/**
 * Paths used by binary-compressed checkpoint scripts.
 *
 * Re-exports infrastructure paths from root, and defines checkpoint-specific paths.
 */

import path from 'node:path'

import { PACKAGE_ROOT, getBuildPaths } from '../../paths.mjs'

// Re-export infrastructure paths
export { PACKAGE_ROOT, getBuildPaths }

// Checkpoint-specific paths (defined here, not in root paths.mjs)
export const COMPRESSION_TOOLS_DIR = path.join(
  PACKAGE_ROOT,
  'compression-tools',
)

export const ADDITIONS_COMPRESSION_TOOLS_DIR = path.join(
  PACKAGE_ROOT,
  'additions',
  '003-compression-tools',
)

export const COMPRESS_BINARY_SCRIPT = path.join(
  PACKAGE_ROOT,
  'scripts',
  'binary-compressed',
  'shared',
  'compress-binary.mjs',
)
