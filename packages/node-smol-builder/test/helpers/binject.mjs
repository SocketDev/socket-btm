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
 * @param {string} resourceName - Resource name (e.g., 'NODE_SEA_BLOB', 'SOCKSEC_VFS_BLOB', 'BOTH')
 * @param {string|object} resourcePath - Path to the resource file, or { sea: string, vfs: string } for dual injection
 * @param {object} options - Additional options
 * @param {string} options.testDir - Test directory (for file resolution)
 * @param {string} [options.vfsMode] - VFS mode: 'on-disk' (default), 'in-memory', or 'compat'
 * @returns {Promise<object>} Spawn result
 */
export async function runBinject(
  binaryPath,
  resourceName,
  resourcePath,
  options,
) {
  const { testDir, vfsMode = 'on-disk' } = options

  // Convert binary path to absolute
  const absoluteBinaryPath = path.isAbsolute(binaryPath)
    ? binaryPath
    : path.join(testDir, binaryPath)

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

  // Build args based on resource type
  const args = ['inject', '-e', absoluteBinaryPath, '-o', absoluteBinaryPath]

  if (resourceName === 'BOTH') {
    // Dual injection: both SEA and VFS
    const seaPath = path.isAbsolute(resourcePath.sea)
      ? resourcePath.sea
      : path.join(testDir, resourcePath.sea)

    args.push('--sea', seaPath)

    // Handle VFS mode
    if (vfsMode === 'compat') {
      // VFS compatibility mode (no file bundling)
      args.push('--vfs-compat')
    } else {
      const vfsPath = path.isAbsolute(resourcePath.vfs)
        ? resourcePath.vfs
        : path.join(testDir, resourcePath.vfs)

      if (vfsMode === 'in-memory') {
        args.push('--vfs-in-memory', vfsPath)
      } else {
        // Default: on-disk
        args.push('--vfs-on-disk', vfsPath)
      }
    }
  } else {
    // Single injection: either SEA or VFS
    const absoluteResourcePath = path.isAbsolute(resourcePath)
      ? resourcePath
      : path.join(testDir, resourcePath)

    if (resourceName === 'NODE_SEA_BLOB') {
      args.push('--sea', absoluteResourcePath)
    } else if (resourceName === 'SOCKSEC_VFS_BLOB') {
      // VFS must be injected with SEA, so we need to check if SEA already exists
      // For now, just add --vfs flag (binject will error if SEA is missing)
      if (vfsMode === 'in-memory') {
        args.push('--vfs-in-memory', absoluteResourcePath)
      } else if (vfsMode === 'compat') {
        args.push('--vfs-compat')
      } else {
        args.push('--vfs-on-disk', absoluteResourcePath)
      }
    } else {
      throw new Error(
        `Unknown resource name: ${resourceName}. Expected NODE_SEA_BLOB, SOCKSEC_VFS_BLOB, or BOTH`,
      )
    }
  }

  // Build binject arguments using new CLI format:
  // binject inject -e <executable> -o <output> [--sea <path>] [--vfs <path>]

  // Note: binject automatically handles:
  // - SEA blobs: Written to NODE_SEA/__NODE_SEA_BLOB (no compression, auto sentinel flip)
  // - VFS blobs: Written to NODE_SEA/__SMOL_VFS_BLOB (no compression - binpress compresses entire binary)
  // - All platforms: Creates sections dynamically (no placeholders needed)
  //   - Linux: Appends new ELF sections
  //   - Windows: Appends new PE sections
  //   - macOS: Uses LIEF to create Mach-O sections

  // Run binject (it handles everything: injection, sentinel flipping, section resizing)
  const result = await spawn(binjectPath, args, { cwd: testDir })

  // Log errors for debugging
  if (result.code !== 0) {
    console.error('binject failed:')
    console.error('Command:', binjectPath, ...args)
    console.error('Exit code:', result.code)
    console.error('stderr:', result.stderr)
    console.error('stdout:', result.stdout)
  }

  // On macOS, binary must be code-signed after injection
  // Note: binject has already handled section resizing and sentinel flipping
  if (result.code === 0 && process.platform === 'darwin') {
    await spawn('codesign', ['--sign', '-', '--force', absoluteBinaryPath])
  }

  return result
}
