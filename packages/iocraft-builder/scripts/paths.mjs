/**
 * Centralized path resolution for iocraft-builder.
 *
 * This is the source of truth for all build paths.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { getCurrentPlatformArch } from 'build-infra/lib/platform-mappings'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Package root: scripts/../
export const PACKAGE_ROOT = path.resolve(__dirname, '..')

// Source files
export const CARGO_TOML = path.join(PACKAGE_ROOT, 'Cargo.toml')
export const SRC_DIR = path.join(PACKAGE_ROOT, 'src')

// Build directories
export const BUILD_ROOT = path.join(PACKAGE_ROOT, 'build')

// Upstream path
export const UPSTREAM_PATH = path.join(PACKAGE_ROOT, 'upstream/iocraft')

/**
 * Get shared build directories for pristine artifacts (shared across dev/prod).
 */
export function getSharedBuildPaths() {
  const buildDir = path.join(BUILD_ROOT, 'shared')
  const sourceCopiedDir = path.join(buildDir, 'source-copied', 'iocraft')
  const checkpointsDir = path.join(buildDir, 'checkpoints')

  return {
    buildDir,
    checkpointsDir,
    sourceCopiedDir,
  }
}

/**
 * Get build directories for a specific mode (dev/prod) with REQUIRED platformArch.
 * @param {string} mode - Build mode ('dev' or 'prod')
 * @param {string} platformArch - Platform-arch (e.g., 'darwin-arm64') - REQUIRED
 */
export function getBuildPaths(mode, platformArch) {
  if (!platformArch) {
    throw new Error('platformArch is required for getBuildPaths()')
  }

  const buildDir = path.join(BUILD_ROOT, mode, platformArch)
  const sourcePatchedDir = path.join(buildDir, 'source-patched', 'iocraft')
  const checkpointsDir = path.join(buildDir, 'checkpoints')
  const targetDir = path.join(buildDir, 'target')
  const outDir = path.join(buildDir, 'out')

  // Platform-specific output paths
  const getPlatformOutputPath = platform => {
    return path.join(outDir, platform, 'iocraft.node')
  }

  return {
    buildDir,
    checkpointsDir,
    getPlatformOutputPath,
    outDir,
    sourcePatchedDir,
    targetDir,
  }
}

/**
 * Get the current platform identifier using shared utility.
 * Handles musl detection and respects TARGET_ARCH environment variable.
 */
export async function getCurrentPlatform() {
  return await getCurrentPlatformArch()
}

/**
 * All supported platforms for cross-compilation.
 */
export const SUPPORTED_PLATFORMS = [
  'darwin-arm64',
  'darwin-x64',
  'linux-arm64',
  'linux-arm64-musl',
  'linux-x64',
  'linux-x64-musl',
  'win-arm64',
  'win-x64',
]
