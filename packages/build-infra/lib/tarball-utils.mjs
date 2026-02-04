/**
 * Shared tarball extraction utilities.
 *
 * Provides secure tarball extraction with path traversal protection
 * and cross-platform Windows/Unix compatibility.
 */

import path from 'node:path'

import { which } from '@socketsecurity/lib/bin'
import { WIN32 } from '@socketsecurity/lib/constants/platform'
import { safeMkdir } from '@socketsecurity/lib/fs'
import { toUnixPath } from '@socketsecurity/lib/paths/normalize'
import { spawn } from '@socketsecurity/lib/spawn'

import { tarSupportsNoAbsoluteNames } from './platform-mappings.mjs'

/**
 * Convert Windows paths to Unix format for Git Bash tar compatibility.
 * Git Bash tar interprets D: as a hostname, so we need /d/path format.
 *
 * @param {string} p - Path to convert.
 * @returns {string} Unix-style path on Windows, unchanged on other platforms.
 */
export function toTarPath(p) {
  if (!WIN32) {
    return p
  }
  // Convert to Git Bash format: D:\path → /d/path.
  return toUnixPath(p)
}

/**
 * Validate tarball contents for path traversal attacks.
 * Throws if any file in the tarball has an unsafe path.
 *
 * @param {string} tarballPath - Path to the tarball file.
 * @returns {Promise<string[]>} Array of file paths in the tarball.
 * @throws {Error} If tarball contains unsafe paths.
 */
export async function validateTarballPaths(tarballPath) {
  const tarBin = await which('tar')
  const unixTarballPath = toTarPath(tarballPath)

  // List tarball contents.
  const listResult = await spawn(tarBin, ['-tzf', unixTarballPath], {
    stdio: 'pipe',
  })

  const files = listResult.stdout
    .split('\n')
    .filter(Boolean)
    .map(f => f.trim())

  // Check for path traversal attempts.
  for (const file of files) {
    const normalized = path.normalize(file)
    if (normalized.startsWith('..') || path.isAbsolute(normalized)) {
      throw new Error(
        `Tarball contains unsafe path: ${file} (path traversal attempt detected)`,
      )
    }
  }

  return files
}

/**
 * Securely extract a tarball to a directory.
 * Validates paths before extraction and uses --no-absolute-names when supported.
 *
 * @param {string} tarballPath - Path to the tarball file.
 * @param {string} extractDir - Directory to extract to.
 * @param {object} options - Extraction options.
 * @param {boolean} [options.validate=true] - Validate paths before extraction.
 * @param {boolean} [options.createDir=true] - Create extraction directory if missing.
 * @param {'pipe' | 'inherit' | 'ignore'} [options.stdio='ignore'] - Stdio option for tar.
 * @param {number} [options.stripComponents=0] - Number of leading path components to strip.
 * @returns {Promise<string[]>} Array of extracted file paths.
 * @throws {Error} If extraction fails or paths are unsafe.
 */
export async function extractTarball(tarballPath, extractDir, options = {}) {
  const {
    createDir = true,
    stdio = 'ignore',
    stripComponents = 0,
    validate = true,
  } = options

  // Create extraction directory if needed.
  if (createDir) {
    await safeMkdir(extractDir)
  }

  // Validate tarball paths before extraction.
  let files = []
  if (validate) {
    files = await validateTarballPaths(tarballPath)
  }

  const tarBin = await which('tar')
  const unixTarballPath = toTarPath(tarballPath)
  const unixExtractDir = toTarPath(extractDir)

  // Build extraction arguments.
  const tarArgs = ['-xzf', unixTarballPath, '-C', unixExtractDir]

  // Strip leading path components if requested.
  if (stripComponents > 0) {
    tarArgs.push(`--strip-components=${stripComponents}`)
  }

  // Add --no-absolute-names on platforms that support it (defense in depth).
  if (await tarSupportsNoAbsoluteNames()) {
    tarArgs.push('--no-absolute-names')
  }

  // Extract.
  const result = await spawn(tarBin, tarArgs, { stdio })
  if (result.code !== 0) {
    throw new Error(`tar extraction failed with exit code ${result.code}`)
  }

  return files
}
