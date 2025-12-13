/**
 * Paths used by binary-compressed checkpoint scripts.
 *
 * Re-exports infrastructure paths from root, and defines checkpoint-specific paths.
 */

import path from 'node:path'

import {
  BINFLATE_DIR,
  BINJECT_DIR,
  BINPRESS_DIR,
  PACKAGE_ROOT,
  getBuildPaths,
} from '../../paths.mjs'

// Re-export infrastructure paths
export { BINFLATE_DIR, BINJECT_DIR, BINPRESS_DIR, PACKAGE_ROOT, getBuildPaths }

// Checkpoint-specific paths (defined here, not in root paths.mjs)

export const COMPRESS_BINARY_SCRIPT = path.join(
  PACKAGE_ROOT,
  'scripts',
  'binary-compressed',
  'shared',
  'compress-binary.mjs',
)
