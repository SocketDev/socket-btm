/**
 * @file Shared test paths for finding the latest Node.js binaries. This module
 *   provides path resolution for test files to find the latest binaries from
 *   build/{dev,prod}/{platform-arch}/out/{Stripped,Compressed}/node and
 *   build/{dev,prod}/{platform-arch}/out/Final/node/ (directory structure).
 */

import { readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { fileURLToPath } from 'node:url'

import {
  getBuildPaths,
  getDefaultPlatformArch,
  MONOREPO_ROOT,
} from '../scripts/paths.mts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const packageDir = path.resolve(__dirname, '..')

export interface BinaryCandidate {
  mtime: number
  path: string
}

const CHECKPOINT_FILE_BY_STAGE: Readonly<Record<string, string>> = {
  Compressed: 'binary-compressed.json',
  Final: 'finalized.json',
  Release: 'binary-released.json',
  Stripped: 'binary-stripped.json',
}

const expectedNodeVersion = readFileSync(
  path.join(MONOREPO_ROOT, '.node-version'),
  'utf8',
)
  .trim()
  .replace(/^v/, '')

/**
 * Return true when a build checkpoint targets the currently pinned Node.
 */
export function checkpointMatchesNodeVersion(
  checkpointPath: string,
  expectedVersion: string = expectedNodeVersion,
): boolean {
  try {
    const checkpoint = JSON.parse(readFileSync(checkpointPath, 'utf8')) as {
      nodeVersion?: unknown | undefined
    }
    return (
      typeof checkpoint.nodeVersion === 'string' &&
      checkpoint.nodeVersion.replace(/^v/, '') ===
        expectedVersion.replace(/^v/, '')
    )
  } catch {
    return false
  }
}

/**
 * Add a candidate if the binary exists.
 *
 * @param {Array} candidates - Array to add to.
 * @param {string} binaryPath - Path to check.
 */
export function addCandidate(
  candidates: BinaryCandidate[],
  binaryPath: string,
  checkpointPath: string,
) {
  if (!checkpointMatchesNodeVersion(checkpointPath)) {
    return
  }
  try {
    const stat = statSync(binaryPath)
    candidates.push({ mtime: stat.mtimeMs, path: binaryPath })
  } catch {
    // Binary doesn't exist
  }
}

/**
 * Get binary path for a given stage from build paths.
 *
 * @param {object} buildPaths - Build paths from getBuildPaths()
 * @param {string} stage - Build stage.
 *
 * @returns {string} Binary path
 */
export function getBinaryPath(
  buildPaths: ReturnType<typeof getBuildPaths>,
  stage: string,
): string {
  switch (stage) {
    case 'Release':
      return buildPaths.outputReleaseBinary
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
 * Find the latest binary from
 * build/{dev,prod}/{platform-arch}/out/{stage}/node/node. Returns the path to
 * whichever exists and has the latest modification time, or undefined if none
 * exists so callers can skipIf without a built binary.
 *
 * @param {string} stage - Build stage: 'Stripped', 'Compressed', or 'Final'
 *
 * @returns {string | undefined} Path to the latest binary, or undefined if not
 *   built.
 */
export function getLatestBinary(stage: string): string | undefined {
  const candidates: BinaryCandidate[] = []
  const platformArch = getDefaultPlatformArch()

  // Check both dev and prod.
  // oxlint-disable-next-line socket/prefer-cached-for-loop -- iterable is not a bare identifier (could be Map/Set/Generator/expression)
  for (const mode of ['dev', 'prod']) {
    const buildPaths = getBuildPaths(mode, process.platform, platformArch)
    const binary = getBinaryPath(buildPaths, stage)
    const checkpointFile = CHECKPOINT_FILE_BY_STAGE[stage]
    if (checkpointFile) {
      addCandidate(
        candidates,
        binary,
        path.join(buildPaths.buildDir, 'checkpoints', checkpointFile),
      )
    }
  }

  if (candidates.length === 0) {
    return undefined
  }

  // Sort by modification time (newest first) and return the latest
  candidates.sort((a, b) => b.mtime - a.mtime)
  return candidates[0]?.path
}

/**
 * Find the latest Compressed binary from
 * build/{dev,prod}/{platform-arch}/out/Compressed/node/node. This binary tests
 * the compression extraction feature. Returns the path to whichever exists and
 * has the latest modification time.
 *
 * @returns {string | undefined} Path to the latest Compressed binary, or
 *   undefined if not built.
 */
export function getLatestCompressedBinary() {
  return getLatestBinary('Compressed')
}

/**
 * Find the latest Final binary from
 * build/{dev,prod}/{platform-arch}/out/Final/node/node. This is the compressed
 * binary suitable for production use. Returns the path to whichever exists and
 * has the latest modification time.
 *
 * @returns {string | undefined} Path to the latest Final binary, or undefined
 *   if not built.
 */
export function getLatestFinalBinary() {
  return getLatestBinary('Final')
}

/**
 * Find the latest Release binary built for the currently pinned Node.
 */
export function getLatestReleaseBinary() {
  return getLatestBinary('Release')
}

/**
 * Find the latest Stripped binary from
 * build/{dev,prod}/{platform-arch}/out/Stripped/node/node.
 *
 * The Stripped binary has debug symbols removed but retains pre-created Mach-O
 * sections (NODE_SEA_BLOB, SMOL_VFS_BLOB) required for binject injection.
 *
 * Returns the path to whichever exists and has the latest modification time.
 *
 * @returns {string | undefined} Path to the latest Stripped binary, or
 *   undefined if not built.
 */
export function getLatestStrippedBinary() {
  return getLatestBinary('Stripped')
}

/**
 * Get the package directory.
 *
 * @returns {string} Path to the package root directory
 */
export function getPackageDir() {
  return packageDir
}
