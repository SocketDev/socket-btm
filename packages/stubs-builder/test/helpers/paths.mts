/**
 * @fileoverview Shared test paths for finding the latest compressed binaries.
 *
 * This module provides path resolution for test files to find the latest
 * binaries from build/{dev,prod}/{platform}/out/Final/.
 */

import { statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { fileURLToPath } from 'node:url'

import { getPlatformArch } from 'build-infra/lib/platform-mappings'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const packageDir = path.resolve(__dirname, '../..')
const PLATFORM_ARCH = getPlatformArch(process.platform, process.arch, undefined)

/**
 * Find the latest Final binary from build/{dev,prod}/{platform}/out/Final/.
 * Returns the path to whichever exists and has the latest modification time.
 *
 * @returns {string|null} Path to the latest Final binary, or null if none exist
 */
export function getLatestFinalBinary() {
  // stubs-builder builds compressed stubs at build/{dev,prod}/{platform}/out/Final/
  const devBinaryPath = path.join(
    packageDir,
    'build',
    'dev',
    PLATFORM_ARCH,
    'out',
    'Final',
  )
  const prodBinaryPath = path.join(
    packageDir,
    'build',
    'prod',
    PLATFORM_ARCH,
    'out',
    'Final',
  )

  const candidates = []

  // Check dev binary.
  try {
    const devStat = statSync(devBinaryPath)
    if (devStat.isFile()) {
      candidates.push({ mtime: devStat.mtimeMs, path: devBinaryPath })
    }
  } catch {
    // Dev binary doesn't exist.
  }

  // Check prod binary.
  try {
    const prodStat = statSync(prodBinaryPath)
    if (prodStat.isFile()) {
      candidates.push({ mtime: prodStat.mtimeMs, path: prodBinaryPath })
    }
  } catch {
    // Prod binary doesn't exist.
  }

  if (!candidates.length) {
    return null
  }

  // Sort by modification time (newest first) and return the latest.
  candidates.sort((a, b) => b.mtime - a.mtime)
  return candidates[0].path
}

/**
 * Get the package directory.
 * @returns {string} Path to the package root directory
 */
export function getPackageDir() {
  return packageDir
}
