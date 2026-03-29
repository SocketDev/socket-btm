/**
 * @fileoverview Shared test paths for finding the latest Node.js binaries.
 *
 * This module provides path resolution for test files to find the latest
 * binaries from build/{dev,prod}/out/{Stripped,Compressed}/node and
 * build/{dev,prod}/out/Final/node/ (directory structure).
 *
 * Supports both local builds (build/{mode}/out/) and CI builds with
 * platform-arch organization (build/{mode}/{platform-arch}/out/).
 */

import { statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { fileURLToPath } from 'node:url'

import { getBuildPaths, getDefaultPlatformArch } from '../scripts/paths.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const packageDir = path.resolve(__dirname, '..')

/**
 * Find the latest binary from build/{dev,prod}/out/{stage}/node/node.
 * Returns the path to whichever exists and has the latest modification time.
 *
 * Checks both local paths (build/{mode}/out/) and CI paths with platform-arch
 * organization (build/{mode}/{platform-arch}/out/).
 *
 * @param {string} stage - Build stage: 'Stripped', 'Compressed', or 'Final'
 * @returns {string} Path to the latest binary
 * @throws {Error} If no binary exists
 */
function getLatestBinary(stage) {
  const candidates = []
  const platformArch = getDefaultPlatformArch()

  // Check both dev and prod, with and without platform-arch
  for (const mode of ['dev', 'prod']) {
    // Local build paths (no platform-arch)
    const localPaths = getBuildPaths(mode)
    const localBinary = getBinaryPath(localPaths, stage)
    addCandidate(candidates, localBinary)

    // CI build paths (with platform-arch)
    const ciPaths = getBuildPaths(mode, process.platform, platformArch)
    const ciBinary = getBinaryPath(ciPaths, stage)
    addCandidate(candidates, ciBinary)
  }

  if (candidates.length === 0) {
    throw new Error(
      `No ${stage} binary found. Build binaries first: pnpm --filter node-smol-builder build`,
    )
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
