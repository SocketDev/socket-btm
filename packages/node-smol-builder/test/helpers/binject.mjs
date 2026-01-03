/**
 * @fileoverview Helper functions for running binject in tests.
 *
 * Wraps binject CLI calls with proper path handling and macOS code-signing.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { BUILD_STAGES, getBuildMode } from 'build-infra/lib/constants'

import { spawn } from '@socketsecurity/lib/spawn'

import { BINJECT_DIR } from '../../scripts/paths.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const _packageDir = path.resolve(__dirname, '..', '..')

/**
 * Runs binject with proper context.
 *
 * Uses the binject binary from the binject package.
 * Binary path is made absolute, resource path stays relative.
 *
 * Note: binject automatically handles compressed self-extracting stubs by
 * detecting the cache key and using the extracted binary from ~/.socket/_dlx/
 *
 * @param {string} binaryPath - Path to the binary to inject into (can be compressed stub)
 * @param {string} resourceName - Resource name (e.g., 'NODE_SEA_BLOB')
 * @param {string} resourcePath - Path to the resource file (relative to testDir)
 * @param {object} options - Additional options
 * @param {string} options.testDir - Test directory (for file resolution)
 * @returns {Promise<object>} Spawn result
 */
export async function runBinject(
  binaryPath,
  resourceName,
  resourcePath,
  options,
) {
  const { testDir } = options

  // Convert binary path to absolute
  const absoluteBinaryPath = path.isAbsolute(binaryPath)
    ? binaryPath
    : path.join(testDir, binaryPath)

  // Convert resource path to absolute
  const absoluteResourcePath = path.isAbsolute(resourcePath)
    ? resourcePath
    : path.join(testDir, resourcePath)

  // Path to binject binary
  const BUILD_MODE = getBuildMode()
  const binjectName = process.platform === 'win32' ? 'binject.exe' : 'binject'
  const binjectPath = path.join(
    BINJECT_DIR,
    'build',
    BUILD_MODE,
    'out',
    BUILD_STAGES.FINAL,
    binjectName,
  )

  // Map resource names to binject flags
  let flag
  if (resourceName === 'NODE_SEA_BLOB') {
    flag = '--sea'
  } else if (resourceName === 'SOCKSEC_VFS_BLOB') {
    flag = '--vfs'
  } else {
    throw new Error(
      `Unknown resource name: ${resourceName}. Expected NODE_SEA_BLOB or SOCKSEC_VFS_BLOB`,
    )
  }

  // Build binject arguments using new flag-based CLI format:
  // binject inject -e <executable> -r <resource> --vfs|--sea
  const args = [
    'inject',
    '-e',
    absoluteBinaryPath,
    '-r',
    absoluteResourcePath,
    flag,
  ]

  // Note: binject automatically handles:
  // - SEA blobs: Written to NODE_SEA/__NODE_SEA_BLOB (no compression, auto sentinel flip)
  // - VFS blobs: Written to NODE_SEA/__NODE_VFS_BLOB (no compression - binpress compresses entire binary)
  // - All platforms: Creates sections dynamically (no placeholders needed)
  //   - Linux: Appends new ELF sections
  //   - Windows: Appends new PE sections
  //   - macOS: Uses LIEF to create Mach-O sections

  // Run binject (it handles everything: injection, sentinel flipping, section resizing)
  const result = await spawn(binjectPath, args, { cwd: testDir })

  // On macOS, binary must be code-signed after injection
  // Note: binject has already handled section resizing and sentinel flipping
  if (result.code === 0 && process.platform === 'darwin') {
    await spawn('codesign', ['--sign', '-', '--force', absoluteBinaryPath])
  }

  return result
}
