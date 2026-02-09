/**
 * @fileoverview Shared test paths for finding the latest Node.js binaries.
 *
 * This module provides path resolution for test files to find the latest
 * binaries from build/{dev,prod}/out/{Stripped,Compressed}/node and
 * build/{dev,prod}/out/Final/node/ (directory structure).
 */

import { statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const packageDir = path.resolve(__dirname, '..')

/**
 * Find the latest binary from build/{dev,prod}/out/{stage}/node/node.
 * Returns the path to whichever exists and has the latest modification time.
 *
 * Note: All stages use a directory structure (out/{Stage}/node/node) for
 * consistency with curl and mbedtls directories.
 *
 * @param {string} stage - Build stage: 'Release', 'Stripped', 'Compressed', or 'Final'
 * @returns {string} Path to the latest binary
 * @throws {Error} If neither dev nor prod binary exists
 */
function getLatestBinary(stage) {
  // All stages use directory structure: out/{Stage}/node/node.
  const binaryPath = ['node', 'node']

  const devBinaryPath = path.join(
    packageDir,
    'build',
    'dev',
    'out',
    stage,
    ...binaryPath,
  )
  const prodBinaryPath = path.join(
    packageDir,
    'build',
    'prod',
    'out',
    stage,
    ...binaryPath,
  )

  const candidates = []

  // Check dev binary
  try {
    const devStat = statSync(devBinaryPath)
    candidates.push({ path: devBinaryPath, mtime: devStat.mtimeMs })
  } catch {
    // Dev binary doesn't exist
  }

  // Check prod binary
  try {
    const prodStat = statSync(prodBinaryPath)
    candidates.push({ path: prodBinaryPath, mtime: prodStat.mtimeMs })
  } catch {
    // Prod binary doesn't exist
  }

  if (candidates.length === 0) {
    return
  }

  // Sort by modification time (newest first) and return the latest
  candidates.sort((a, b) => b.mtime - a.mtime)
  return candidates[0].path
}

/**
 * Find the latest Stripped binary from build/{dev,prod}/out/Stripped/node/node.
 *
 * The Stripped binary has debug symbols removed but retains pre-created Mach-O sections
 * (NODE_SEA_BLOB, SMOL_VFS_BLOB) required for binject injection.
 *
 * Returns the path to whichever exists and has the latest modification time.
 *
 * @returns {string} Path to the latest Stripped binary
 * @throws {Error} If neither dev nor prod Stripped binary exists
 */
export function getLatestStrippedBinary() {
  return getLatestBinary('Stripped')
}

/**
 * Find the latest Final binary from build/{dev,prod}/out/Final/node/node.
 * This is the compressed binary suitable for production use.
 * Returns the path to whichever exists and has the latest modification time.
 *
 * @returns {string} Path to the latest Final binary
 * @throws {Error} If neither dev nor prod Final binary exists
 */
export function getLatestFinalBinary() {
  return getLatestBinary('Final')
}

/**
 * Find the latest Compressed binary from build/{dev,prod}/out/Compressed/node/node.
 * This binary tests the compression extraction feature.
 * Returns the path to whichever exists and has the latest modification time.
 *
 * @returns {string} Path to the latest Compressed binary
 * @throws {Error} If neither dev nor prod Compressed binary exists
 */
export function getLatestCompressedBinary() {
  return getLatestBinary('Compressed')
}

/**
 * Get the package directory.
 * @returns {string} Path to the package root directory
 */
export function getPackageDir() {
  return packageDir
}
