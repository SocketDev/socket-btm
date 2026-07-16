/**
 * @file Find a suitable Node.js binary for SEA-config VFS tests — prefers a
 *   local node-smol build, falls back to the running system Node.js. Split
 *   out of sea-config-vfs.test.mts so it can be shared with its
 *   error/edge-case sibling test file without importing a `.test.mts`
 *   module (which would re-run that file's own describe blocks).
 */

import { promises as fs } from 'node:fs'
import process from 'node:process'

import { getPlatformArch } from 'build-infra/lib/platform-mappings'

import { getBuildPaths as getNodeSmolBuildPaths } from 'node-smol-builder/scripts/paths'

const PLATFORM_ARCH = getPlatformArch(process.platform, process.arch, undefined)

/**
 * Find a suitable Node.js binary for testing.
 */
export async function findNodeBinary() {
  // Local node-smol builds — paths come from node-smol-builder's paths.mts
  // so the on-disk layout stays in one place. outputFinalBinary already
  // encodes the platform-specific binary name (node vs node.exe).
  const possiblePaths = [
    getNodeSmolBuildPaths('dev', process.platform, PLATFORM_ARCH)
      .outputFinalBinary,
    getNodeSmolBuildPaths('prod', process.platform, PLATFORM_ARCH)
      .outputFinalBinary,
  ]

  for (let i = 0, { length } = possiblePaths; i < length; i += 1) {
    const binaryPath = possiblePaths[i]
    if (!binaryPath) {
      continue
    }
    try {
      // eslint-disable-next-line no-await-in-loop
      // oxlint-disable-next-line socket/prefer-exists-sync -- access(X_OK) checks executable permission, not just existence; stats.size verifies non-empty binary; existsSync can't substitute for either.
      const stats = await fs.stat(binaryPath)
      if (stats.isFile()) {
        // eslint-disable-next-line no-await-in-loop
        // oxlint-disable-next-line socket/prefer-exists-sync -- access(X_OK) checks executable permission, not just existence; stats.size verifies non-empty binary; existsSync can't substitute for either.
        await fs.access(binaryPath, fs.constants.X_OK)
        return binaryPath
      }
    } catch {
      // Continue to next path.
    }
  }

  // Fall back to system Node.js.
  return process.execPath
}
