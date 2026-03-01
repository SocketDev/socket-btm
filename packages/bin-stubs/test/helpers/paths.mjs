/**
 * @fileoverview Shared test paths for finding the latest compressed binaries.
 *
 * This module provides path resolution for test files to find the latest
 * binaries from build/{dev,prod}/out/Final/.
 */

import { statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const packageDir = path.resolve(__dirname, '../..')

/**
 * Find the latest Final binary from build/{dev,prod}/out/Final/.
 * Returns the path to whichever exists and has the latest modification time.
 *
 * @returns {string|null} Path to the latest Final binary, or null if none exist
 */
export function getLatestFinalBinary() {
  // bin-stubs builds compressed stubs at build/{dev,prod}/out/Final/
  const devBinaryPath = path.join(packageDir, 'build', 'dev', 'out', 'Final')
  const prodBinaryPath = path.join(packageDir, 'build', 'prod', 'out', 'Final')

  const candidates = []

  // Check dev binary.
  try {
    const devStat = statSync(devBinaryPath)
    if (devStat.isFile()) {
      candidates.push({ path: devBinaryPath, mtime: devStat.mtimeMs })
    }
  } catch {
    // Dev binary doesn't exist.
  }

  // Check prod binary.
  try {
    const prodStat = statSync(prodBinaryPath)
    if (prodStat.isFile()) {
      candidates.push({ path: prodBinaryPath, mtime: prodStat.mtimeMs })
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
