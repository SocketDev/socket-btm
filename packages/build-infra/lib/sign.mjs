/**
 * Binary Signing Utilities
 *
 * Provides utilities for code signing binaries on macOS.
 */

import path from 'node:path'

import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

const logger = getDefaultLogger()

/**
 * Ad-hoc code sign a binary for macOS.
 *
 * Uses ad-hoc signing (no certificate required) to satisfy macOS code signing
 * requirements. This is necessary for binaries to execute on modern macOS,
 * especially ARM64 systems.
 *
 * Skips signing if binary is already validly signed (idempotent).
 * Uses --force to replace invalid signatures (e.g., after stripping).
 *
 * @param {string} binaryPath - Absolute path to binary to sign
 * @param {Function} [beforeSign] - Optional callback executed before signing (only on macOS when signing is needed)
 * @returns {Promise<void>}
 */
export async function adHocSign(binaryPath, beforeSign) {
  if (process.platform !== 'darwin') {
    return
  }

  try {
    // Check if already signed
    const checkResult = await spawn('codesign', ['--verify', binaryPath], {
      stdio: 'ignore',
    })
    if (checkResult.code === 0) {
      // Already signed, skip
      return
    }

    // Execute pre-signing callback (e.g., for logging)
    if (beforeSign) {
      await beforeSign()
    }

    // Sign the binary with --force (replace any invalid signature)
    logger.info(`Ad-hoc signing: ${path.basename(binaryPath)}`)
    await spawn('codesign', ['--sign', '-', '--force', binaryPath])
    logger.info('Binary signed successfully')
  } catch {
    // Ignore signing errors (codesign may not be available)
    // This is non-critical - smoke test will catch if binary is unusable
  }
}
