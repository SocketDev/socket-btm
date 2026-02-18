/**
 * @fileoverview Helper utilities for detecting LIEF support in node-smol builds.
 */

import { spawn } from '@socketsecurity/lib/spawn'

import { getLatestFinalBinary } from '../paths.mjs'

/**
 * Check if the build was configured with LIEF support.
 * This checks the BUILD_WITH_LIEF environment variable set by build.mjs.
 *
 * @returns {boolean} True if --with-lief flag was used during build
 */
export function expectLiefEnabled() {
  return process.env.BUILD_WITH_LIEF === 'true'
}

/**
 * Detect if LIEF support is compiled into the Node.js binary.
 * Checks the runtime process.smol.canBuildSea property which reflects
 * the HAVE_LIEF compile-time define.
 *
 * @returns {Promise<boolean>} True if LIEF support is available
 */
export async function hasLiefSupport() {
  const nodePath = getLatestFinalBinary()

  // Check process.smol.canBuildSea at runtime
  const result = await spawn(
    nodePath,
    ['-e', 'console.log(!!process.smol?.canBuildSea)'],
    {
      timeout: 5000,
    },
  )

  if (result.code !== 0) {
    return false
  }

  return result.stdout.trim() === 'true'
}

/**
 * Get LIEF availability status for test descriptions.
 *
 * @returns {Promise<string>} Human-readable LIEF status
 */
export async function getLiefStatus() {
  const hasSupport = await hasLiefSupport()
  return hasSupport ? 'LIEF enabled' : 'LIEF disabled'
}
