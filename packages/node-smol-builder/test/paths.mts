/**
 * @fileoverview Shared test paths for finding the latest Node.js binaries.
 *
 * This module provides path resolution for test files to find the latest
 * binaries from build/{dev,prod}/{platform-arch}/out/{Stripped,Compressed}/node
 * and build/{dev,prod}/{platform-arch}/out/Final/node/ (directory structure).
 */

import { statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { fileURLToPath } from 'node:url'

import { getBuildPaths, getDefaultPlatformArch } from '../scripts/paths.mts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const packageDir = path.resolve(__dirname, '..')

/**
 * Find the latest binary from build/{dev,prod}/{platform-arch}/out/{stage}/node/node.
 * Returns the path to whichever exists and has the latest modification time,
 * or undefined if none exists so callers can skipIf without a built binary.
 *
 * @param {string} stage - Build stage: 'Stripped', 'Compressed', or 'Final'
 * @returns {string | undefined} Path to the latest binary, or undefined if not built
 */
function getLatestBinary(stage) {
  const candidates = []
  const platformArch = getDefaultPlatformArch()

  // Check both dev and prod.
  for (const mode of ['dev', 'prod']) {
    const buildPaths = getBuildPaths(mode, process.platform, platformArch)
    const binary = getBinaryPath(buildPaths, stage)
    addCandidate(candidates, binary)
  }

  if (candidates.length === 0) {
    return undefined
  }

  // Sort by modification time (newest first) and return the latest
  candidates.sort((a, b) => b.mtime - a.mtime)
  return candidates[0].path
}

/**
 * Get binary path for a given stage from build paths.
 * @param {object} buildPaths - Build paths from getBuildPaths()
 * @param {string} stage - Build stage
 * @returns {string} Binary path
 */
function getBinaryPath(buildPaths, stage) {
  switch (stage) {
    case 'Stripped':
      return buildPaths.outputStrippedBinary
    case 'Compressed':
      return buildPaths.outputCompressedBinary
    case 'Final':
      return buildPaths.outputFinalBinary
    default:
      throw new Error(`Unknown stage: ${stage}`)
  }
}

/**
 * Add a candidate if the binary exists.
 * @param {Array} candidates - Array to add to
 * @param {string} binaryPath - Path to check
 */
function addCandidate(candidates, binaryPath) {
  try {
    const stat = statSync(binaryPath)
    candidates.push({ mtime: stat.mtimeMs, path: binaryPath })
  } catch {
    // Binary doesn't exist
  }
}

/**
 * Find the latest Stripped binary from build/{dev,prod}/{platform-arch}/out/Stripped/node/node.
 *
 * The Stripped binary has debug symbols removed but retains pre-created Mach-O sections
 * (NODE_SEA_BLOB, SMOL_VFS_BLOB) required for binject injection.
 *
 * Returns the path to whichever exists and has the latest modification time.
 *
 * @returns {string | undefined} Path to the latest Stripped binary, or undefined if not built
 */
export function getLatestStrippedBinary() {
  return getLatestBinary('Stripped')
}

/**
 * Find the latest Final binary from build/{dev,prod}/{platform-arch}/out/Final/node/node.
 * This is the compressed binary suitable for production use.
 * Returns the path to whichever exists and has the latest modification time.
 *
 * @returns {string | undefined} Path to the latest Final binary, or undefined if not built
 */
export function getLatestFinalBinary() {
  return getLatestBinary('Final')
}

/**
 * Find the latest Compressed binary from build/{dev,prod}/{platform-arch}/out/Compressed/node/node.
 * This binary tests the compression extraction feature.
 * Returns the path to whichever exists and has the latest modification time.
 *
 * @returns {string | undefined} Path to the latest Compressed binary, or undefined if not built
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
