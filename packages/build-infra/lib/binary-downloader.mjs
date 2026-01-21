/**
 * Binary Downloader
 *
 * Utilities for downloading pre-built binaries from GitHub releases.
 * Used as a fallback when native builds or Docker builds are not available.
 */

import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { extract } from '@socketsecurity/lib/tar'

import { printError, printInfo, printSuccess } from './build-output.mjs'
import { getLatestRelease, downloadReleaseAsset } from './github-releases.mjs'

/**
 * Asset naming convention for releases.
 * Format: {package}-{platform}-{arch}[-{libc}].tar.gz
 *
 * Examples:
 *   binpress-linux-x64-glibc.tar.gz
 *   binpress-darwin-arm64.tar.gz
 *   binpress-win32-x64.tar.gz
 */

/**
 * Get the release asset name for a package and target.
 *
 * @param {string} packageName - Package name (e.g., 'binpress')
 * @param {string} target - Build target (e.g., 'linux-x64-glibc')
 * @returns {string} Asset name
 */
export function getAssetName(packageName, target) {
  // Parse target: linux-x64-glibc -> platform=linux, arch=x64, libc=glibc
  const parts = target.split('-')

  if (parts.length === 3) {
    // Linux with libc: linux-x64-glibc
    const [platform, arch, libc] = parts
    return `${packageName}-${platform}-${arch}-${libc}.tar.gz`
  }

  // Darwin or Windows: darwin-arm64, win32-x64
  const [platform, arch] = parts
  return `${packageName}-${platform}-${arch}.tar.gz`
}

/**
 * Get the binary name for a package on a target platform.
 *
 * @param {string} packageName - Package name
 * @param {string} target - Build target
 * @returns {string} Binary name
 */
export function getBinaryName(packageName, target) {
  if (target.startsWith('win32')) {
    return `${packageName}.exe`
  }
  return packageName
}

/**
 * Download a pre-built binary for a specific target.
 *
 * @param {object} options - Download options
 * @param {string} options.packageName - Package to download (e.g., 'binpress')
 * @param {string} options.target - Build target (e.g., 'linux-x64-glibc')
 * @param {string} options.outputDir - Directory to extract binary to
 * @param {string} [options.version] - Specific version to download (default: latest)
 * @returns {Promise<{ok: boolean, artifactPath?: string, version?: string}>}
 */
export async function downloadBinary(options) {
  const { outputDir, packageName, target, version } = options

  // Get version to download
  let releaseTag = version
  if (!releaseTag) {
    printInfo(`Finding latest release for ${packageName}...`)
    releaseTag = await getLatestRelease(packageName)

    if (!releaseTag) {
      printError(`No releases found for ${packageName}`)
      return { ok: false }
    }
  }

  printInfo(`Downloading ${packageName} ${releaseTag} for ${target}...`)

  const assetName = getAssetName(packageName, target)
  const tempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'socket-btm-download-'),
  )
  const downloadPath = path.join(tempDir, assetName)

  try {
    // Download the asset
    await downloadReleaseAsset(releaseTag, assetName, downloadPath)

    // Create output directory
    await fs.mkdir(outputDir, { recursive: true })

    // Extract the archive
    printInfo(`Extracting to ${outputDir}...`)
    await extract({
      file: downloadPath,
      cwd: outputDir,
    })

    // Find the binary
    const binaryName = getBinaryName(packageName, target)
    const artifactPath = path.join(outputDir, binaryName)

    try {
      await fs.access(artifactPath)
      printSuccess(`Downloaded ${packageName} ${releaseTag} for ${target}`)
      return { ok: true, artifactPath, version: releaseTag }
    } catch {
      printError(`Binary ${binaryName} not found in extracted archive`)
      return { ok: false, version: releaseTag }
    }
  } catch (error) {
    printError(`Download failed: ${error.message}`)
    return { ok: false }
  } finally {
    // Cleanup temp directory
    try {
      await fs.rm(tempDir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Verify a downloaded binary matches expected checksum.
 *
 * @param {string} binaryPath - Path to binary
 * @param {string} expectedChecksum - Expected SHA256 checksum
 * @returns {Promise<boolean>}
 */
export async function verifyChecksum(binaryPath, expectedChecksum) {
  try {
    const data = await fs.readFile(binaryPath)
    const hash = createHash('sha256').update(data).digest('hex')

    if (hash === expectedChecksum) {
      return true
    }

    printError(`Checksum mismatch: expected ${expectedChecksum}, got ${hash}`)
    return false
  } catch (error) {
    printError(`Checksum verification failed: ${error.message}`)
    return false
  }
}

/**
 * Download and verify a binary.
 *
 * @param {object} options - Options
 * @param {string} options.packageName - Package name
 * @param {string} options.target - Build target
 * @param {string} options.outputDir - Output directory
 * @param {string} [options.version] - Version to download
 * @param {string} [options.checksum] - Expected checksum (optional)
 * @returns {Promise<{ok: boolean, artifactPath?: string, version?: string}>}
 */
export async function downloadAndVerify(options) {
  const { checksum, ...downloadOptions } = options

  const result = await downloadBinary(downloadOptions)

  if (!result.ok || !result.artifactPath) {
    return result
  }

  // Verify checksum if provided
  if (checksum) {
    const verified = await verifyChecksum(result.artifactPath, checksum)
    if (!verified) {
      // Delete the invalid binary
      try {
        await fs.unlink(result.artifactPath)
      } catch {
        // Ignore
      }
      return { ok: false, version: result.version }
    }
  }

  return result
}

/**
 * Check if a binary is already downloaded and up-to-date.
 *
 * @param {string} packageName - Package name
 * @param {string} target - Build target
 * @param {string} outputDir - Output directory
 * @returns {Promise<{exists: boolean, path?: string}>}
 */
export async function checkExistingBinary(packageName, target, outputDir) {
  const binaryName = getBinaryName(packageName, target)
  const binaryPath = path.join(outputDir, binaryName)

  try {
    const stats = await fs.stat(binaryPath)
    if (stats.isFile() && stats.size > 0) {
      return { exists: true, path: binaryPath }
    }
  } catch {
    // File doesn't exist
  }

  return { exists: false }
}

/**
 * List available release versions for a package.
 *
 * @param {string} packageName - Package name
 * @param {object} [options] - Options
 * @param {number} [options.limit=10] - Maximum number of versions to return
 * @returns {Promise<string[]>} Array of version tags
 */
export async function listAvailableVersions(packageName, _options = {}) {
  // TODO: Implement pagination using the GitHub API
  // For now, just return the latest
  const latest = await getLatestRelease(packageName, { quiet: true })

  if (latest) {
    return [latest]
  }

  return []
}
