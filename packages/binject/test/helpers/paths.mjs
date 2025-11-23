/**
 * Test path helpers for binject
 * Provides consistent binary path resolution across all test files
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PROJECT_ROOT = path.join(__dirname, '..', '..')

// Determine build mode from environment or default to dev
const BUILD_MODE = process.env.BUILD_MODE || 'dev'

/**
 * Get the binject binary path based on build mode
 * @param {string} [platform] - Platform override (defaults to process.platform)
 * @returns {string} Path to binject binary
 */
export function getBinjectPath(platform = process.platform) {
  const BINJECT_NAME = platform === 'win32' ? 'binject.exe' : 'binject'
  return path.join(PROJECT_ROOT, 'build', BUILD_MODE, 'out', BINJECT_NAME)
}

export { PROJECT_ROOT, BUILD_MODE }
