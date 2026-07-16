/**
 * Stub binary property helpers — pure getters and predicates for stub paths
 * and build metadata. Extracted from build-stubs.mts to keep each file under
 * the 500-line soft cap.
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { fileURLToPath } from 'node:url'

import {
  BUILD_STAGES,
  CHECKPOINT_CHAINS,
  getPlatformBuildDir,
  validateCheckpointChain,
} from 'build-infra/lib/constants'
import {
  getAssetPlatformArch,
  parsePlatformArch,
} from 'build-infra/lib/platform-mappings'

import { WIN32 } from '@socketsecurity/lib-stable/constants/platform'
import { detectLibc } from '@socketsecurity/lib-stable/releases/socket-btm'

export { parsePlatformArch }

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const packageRoot = path.join(__dirname, '..')

// Stub source directory (in bin-stub-builder package).
export const stubDir = path.join(packageRoot, '..', 'bin-stub-builder')

/**
 * Get checkpoint chain for CI workflows.
 *
 * @returns {string[]} Checkpoint chain in reverse dependency order
 */
export function getCheckpointChain() {
  const chain = CHECKPOINT_CHAINS.simple()
  validateCheckpointChain(chain, 'build-stubs')
  return chain
}

/**
 * Get current platform-arch for stubs.
 * Respects TARGET_ARCH environment variable for cross-compilation.
 *
 * @returns {Promise<string>} Platform-arch identifier.
 */
export async function getCurrentStubPlatformArch() {
  const libc = detectLibc()
  // Respect TARGET_ARCH for cross-compilation (from environment or process.arch)
  const targetArch = process.env['TARGET_ARCH'] || process.arch
  const arch = targetArch === 'x64' ? 'x64' : targetArch
  // Use asset platform naming (win instead of win32).
  return getAssetPlatformArch(process.platform, arch, libc)
}

/**
 * Get Makefile name for the current platform.
 *
 * @returns {string} Makefile name
 */
export function getMakefileName() {
  switch (process.platform) {
    case 'darwin': {
      return 'Makefile.macos'
    }
    case 'win32': {
      return 'Makefile.win'
    }
    default: {
      return 'Makefile.linux'
    }
  }
}

/**
 * Get stub binary name for the current platform.
 *
 * @returns {string} Stub binary name
 */
export function getStubBinaryName() {
  return WIN32 ? 'smol_stub.exe' : 'smol_stub'
}

/**
 * Get stub output directory path for a given platform.
 * Uses platform-specific build directory for isolation.
 *
 * @param {string} platformArch - Platform-arch identifier (e.g., 'linux-x64',
 *   'darwin-arm64').
 *
 * @returns {string} Path to stub output directory.
 */
export function getStubOutDir(platformArch: string) {
  const buildDir = getPlatformBuildDir(stubDir, platformArch)
  return path.join(buildDir, 'out', BUILD_STAGES.FINAL)
}

/**
 * Get stub binary path for a given platform.
 *
 * @param {string} platformArch - Platform-arch identifier.
 *
 * @returns {string} Path to stub binary.
 */
export function getStubPath(platformArch: string) {
  return path.join(getStubOutDir(platformArch), getStubBinaryName())
}

/**
 * Check if stub binary exists for a given platform.
 *
 * @param {string} platformArch - Platform-arch identifier.
 *
 * @returns {boolean} True if stub binary exists.
 */
export function stubExists(platformArch: string) {
  return existsSync(getStubPath(platformArch))
}

/**
 * Check if stub binary exists at a given directory.
 *
 * @param {string} dir - Directory to check.
 *
 * @returns {boolean} True if stub binary exists.
 */
export function stubExistsAt(dir: string) {
  const stubBinary = getStubBinaryName()
  return existsSync(path.join(dir, stubBinary))
}
