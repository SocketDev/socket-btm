/**
 * Binary Signing Utilities
 *
 * Provides utilities for code signing binaries on macOS.
 */

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'

import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

import { getPlatform } from './build-env.mjs'

const logger = getDefaultLogger()

// Mach-O magic numbers (big-endian and little-endian for 32/64-bit).
// 32-bit big-endian: FEEDFACE.
// 32-bit little-endian: CEFAEDFE.
// 64-bit big-endian: FEEDFACF.
// 64-bit little-endian: CFFAEDFE.
const MACH_O_MAGIC = Object.freeze({
  __proto__: null,
  CEFAEDFE: true,
  CFFAEDFE: true,
  FEEDFACE: true,
  FEEDFACF: true,
})

/**
 * Check if file is a Mach-O binary by reading magic number.
 *
 * @param {string} filePath - Path to file to check.
 * @returns {Promise<boolean>} - True if file is a Mach-O binary.
 */
async function isMachOBinary(filePath) {
  if (!existsSync(filePath)) {
    return false
  }

  try {
    const buffer = Buffer.allocUnsafe(4)
    const fd = await fs.open(filePath, 'r')
    try {
      await fd.read(buffer, 0, 4, 0)
    } finally {
      await fd.close()
    }

    const magic = buffer.toString('hex').toUpperCase()
    return magic in MACH_O_MAGIC
  } catch {
    return false
  }
}

/**
 * Ad-hoc code sign a binary for macOS.
 *
 * Uses ad-hoc signing (no certificate required) to satisfy macOS code signing
 * requirements. This is necessary for binaries to execute on modern macOS,
 * especially ARM64 systems.
 *
 * Skips signing if binary is already validly signed (idempotent).
 * Uses --force to replace invalid signatures (e.g., after stripping).
 * Only signs Mach-O binaries (verified by magic number).
 *
 * @param {string} binaryPath - Absolute path to binary to sign
 * @param {Function} [beforeSign] - Optional callback executed before signing (only on macOS when signing is needed)
 * @returns {Promise<void>}
 */
export async function adHocSign(binaryPath, beforeSign) {
  if (getPlatform() !== 'darwin') {
    return
  }

  // Only sign actual Mach-O binaries (sniff magic number).
  // Skip non-binaries (.wasm, .js, .mjs, etc.).
  if (!(await isMachOBinary(binaryPath))) {
    return
  }

  // Check if already signed (codesign --verify returns non-zero if not signed).
  try {
    await spawn('codesign', ['--verify', binaryPath], {
      stdio: 'ignore',
    })
    // Exit code 0 = already signed, skip.
    return
  } catch {
    // Exit code non-zero = not signed or invalid signature, continue to sign.
  }

  // Execute pre-signing callback (e.g., for logging).
  if (beforeSign) {
    await beforeSign()
  }

  // Sign the binary with --force (replace any invalid signature).
  try {
    logger.info(`Ad-hoc signing: ${path.basename(binaryPath)}`)
    await spawn('codesign', ['--sign', '-', '--force', binaryPath])
    logger.info('Binary signed successfully')
  } catch (err) {
    logger.fail(`Code signing failed: ${err?.message ?? 'Unknown error'}`)
    throw err
  }
}
