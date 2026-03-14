/**
 * Centralized path resolution for iocraft-builder.
 *
 * This is the source of truth for all build paths.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

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
  const checkpointsDir = path.join(buildDir, 'checkpoints')

  return {
    buildDir,
    checkpointsDir,
  }
}

/**
 * Get build directories for a specific mode (dev/prod).
 */
export function getBuildPaths(mode) {
  const buildDir = path.join(BUILD_ROOT, mode)
  const checkpointsDir = path.join(buildDir, 'checkpoints')
  const targetDir = path.join(buildDir, 'target')

  // Output directories
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
    targetDir,
  }
}

/**
 * Get the current platform identifier.
 */
export function getCurrentPlatform() {
  const platform = process.platform
  const arch = process.arch

  const platformMap = {
    darwin: {
      arm64: 'darwin-arm64',
      x64: 'darwin-x64',
    },
    linux: {
      arm64: 'linux-arm64',
      x64: 'linux-x64',
    },
    win32: {
      arm64: 'win32-arm64',
      x64: 'win32-x64',
    },
  }

  return platformMap[platform]?.[arch] ?? `${platform}-${arch}`
}

/**
 * All supported platforms for cross-compilation.
 */
export const SUPPORTED_PLATFORMS = [
  'darwin-arm64',
  'darwin-x64',
  'linux-arm64',
  'linux-x64',
  'win32-arm64',
  'win32-x64',
]
