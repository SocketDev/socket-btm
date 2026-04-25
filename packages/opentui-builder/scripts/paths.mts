/**
 * Centralized path resolution for opentui-builder.
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
export const BUILD_ZIG = path.join(PACKAGE_ROOT, 'build.zig')
export const BUILD_ZIG_ZON = path.join(PACKAGE_ROOT, 'build.zig.zon')
export const SRC_DIR = path.join(PACKAGE_ROOT, 'src')
export const VENDOR_DIR = path.join(PACKAGE_ROOT, 'vendor')

// Build directories
export const BUILD_ROOT = path.join(PACKAGE_ROOT, 'build')

// Upstream path
export const UPSTREAM_PATH = path.join(PACKAGE_ROOT, 'upstream/opentui')
// Vendored Zig dependency — pinned via .gitmodules (uucode-0.2.0).
// Wired into the patched build tree by apply-patches.mts so
// build.zig.zon can reference it via a path instead of a network URL.
export const UUCODE_PATH = path.join(PACKAGE_ROOT, 'upstream/uucode')

/**
 * Zig target triple mapping from platform-arch identifiers.
 */
export const ZIG_TARGETS = {
  __proto__: null,
  'darwin-arm64': 'aarch64-macos',
  'darwin-x64': 'x86_64-macos',
  'linux-arm64': 'aarch64-linux-gnu',
  'linux-arm64-musl': 'aarch64-linux-musl',
  'linux-x64': 'x86_64-linux-gnu',
  'linux-x64-musl': 'x86_64-linux-musl',
  'win-arm64': 'aarch64-windows-gnu',
  'win-x64': 'x86_64-windows-gnu',
}

/**
 * Library file extensions by OS.
 */
export const LIBRARY_EXTENSIONS = {
  __proto__: null,
  darwin: 'dylib',
  linux: 'so',
  win32: 'dll',
}

/**
 * Library file prefixes by OS.
 */
export const LIBRARY_PREFIXES = {
  __proto__: null,
  darwin: 'lib',
  linux: 'lib',
  win32: '',
}

/**
 * Get shared build directories for pristine artifacts (shared across dev/prod).
 */
export function getSharedBuildPaths() {
  const buildDir = path.join(BUILD_ROOT, 'shared')
  const sourceCopiedDir = path.join(buildDir, 'source-copied', 'opentui')
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
  const sourcePatchedDir = path.join(buildDir, 'source-patched', 'opentui')
  const checkpointsDir = path.join(buildDir, 'checkpoints')
  const outDir = path.join(buildDir, 'out')

  // Platform-specific output paths
  const getPlatformOutputPath = platform => {
    return path.join(outDir, platform, 'opentui.node')
  }

  return {
    buildDir,
    checkpointsDir,
    getPlatformOutputPath,
    outDir,
    sourcePatchedDir,
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
