/**
 * @file Find a suitable Node.js binary for SEA-config VFS tests — prefers a
 *   local node-smol build, falls back to the running system Node.js. Split
 *   out of sea-config-vfs.test.mts so it can be shared with its
 *   error/edge-case sibling test file without importing a `.test.mts`
 *   module (which would re-run that file's own describe blocks).
 */

import process from 'node:process'

import { getLatestFinalBinary } from '../../../node-smol-builder/test/paths.mts'

/**
 * Find a suitable Node.js binary for testing.
 */
export async function findNodeBinary() {
  return getLatestFinalBinary() ?? process.execPath
}
