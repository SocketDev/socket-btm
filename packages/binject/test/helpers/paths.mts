/**
 * Test path helpers for binject
 * Provides consistent binary path resolution across all test files
 */

import path from 'node:path'
import process from 'node:process'

import { fileURLToPath } from 'node:url'

import { getBuildMode } from 'build-infra/lib/constants'
import { getFinalBinaryPath } from 'build-infra/lib/paths'
import { getPlatformArch } from 'build-infra/lib/platform-mappings'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PROJECT_ROOT = path.join(__dirname, '..', '..')
const BINPRESS_ROOT = path.join(PROJECT_ROOT, '..', 'binpress')
const BINFLATE_ROOT = path.join(PROJECT_ROOT, '..', 'binflate')

const BUILD_MODE = getBuildMode()
const PLATFORM_ARCH = getPlatformArch(process.platform, process.arch, undefined)

/**
 * Get the binject binary path based on build mode
 * @param {string} [platform] - Platform override (defaults to process.platform)
 * @returns {string} Path to binject binary
 */
export function getBinjectPath(platform = process.platform) {
  const binaryName = platform === 'win32' ? 'binject.exe' : 'binject'
  return getFinalBinaryPath(PROJECT_ROOT, BUILD_MODE, PLATFORM_ARCH, binaryName)
}

/**
 * Get the binpress binary path based on build mode
 * @param {string} [platform] - Platform override (defaults to process.platform)
 * @returns {string} Path to binpress binary
 */
export function getBinpressPath(platform = process.platform) {
  const binaryName = platform === 'win32' ? 'binpress.exe' : 'binpress'
  return getFinalBinaryPath(BINPRESS_ROOT, BUILD_MODE, PLATFORM_ARCH, binaryName)
}

/**
 * Get the binflate binary path based on build mode
 * @param {string} [platform] - Platform override (defaults to process.platform)
 * @returns {string} Path to binflate binary
 */
export function getBinflatePath(platform = process.platform) {
  const binaryName = platform === 'win32' ? 'binflate.exe' : 'binflate'
  return getFinalBinaryPath(BINFLATE_ROOT, BUILD_MODE, PLATFORM_ARCH, binaryName)
}

export { PROJECT_ROOT, BUILD_MODE }
