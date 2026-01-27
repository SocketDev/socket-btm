/**
 * @fileoverview Shared helpers for compression tool download and verification.
 * Provides DRY utilities for ensuring binpress tool availability.
 *
 * Note: binflate (decompressor) is no longer downloaded here because the
 * self-extracting stub has built-in decompression - no external binflate needed.
 *
 * Naming convention:
 * - ensure*: Download if missing, then verify
 */

import { existsSync } from 'node:fs'
import path from 'node:path'

import { envIsTrue } from 'build-infra/lib/build-env'
import { getPlatformArch } from 'build-infra/lib/platform-mappings'

import { getDefaultLogger } from '@socketsecurity/lib/logger'
import {
  detectLibc,
  downloadSocketBtmRelease,
} from '@socketsecurity/lib/releases/socket-btm'

import { PACKAGE_ROOT } from '../../paths.mjs'

const logger = getDefaultLogger()

/**
 * Download a compression tool if it doesn't exist.
 *
 * Environment variables:
 * - BUILD_TOOLS_FROM_SOURCE=true: Build binsuite tools (binpress/binflate/binject) from source
 *   instead of downloading from releases. Used in Docker builds to test local changes.
 * - BUILD_DEPS_FROM_SOURCE=true: Build LIEF from source during binsuite builds.
 *   Requires it to be pre-installed on the system. (Implemented in CMake build scripts)
 * - BUILD_ALL_FROM_SOURCE=true: Shortcut for both BUILD_TOOLS_FROM_SOURCE and BUILD_DEPS_FROM_SOURCE.
 *
 * @param {string} tool - Tool name (binpress)
 * @param {string} platform - Target platform
 * @param {string} arch - Target architecture
 * @param {string|undefined} libc - Target libc (musl, glibc, or undefined)
 * @returns {Promise<string>} Path to downloaded tool
 */
async function downloadToolIfMissing(tool, platform, arch, libc) {
  const ext = platform === 'win32' ? '.exe' : ''
  const platformArch = getPlatformArch(platform, arch, libc)
  const buildAllFromSource = envIsTrue(process.env.BUILD_ALL_FROM_SOURCE)
  const buildToolsFromSource =
    buildAllFromSource || envIsTrue(process.env.BUILD_TOOLS_FROM_SOURCE)

  // Check if the requested platform matches the current runtime platform.
  // Local builds (packages/{tool}/build/*/out/Final/) are built for the host platform,
  // so they can only be used when the runtime platform matches.
  // This prevents using macOS-built binaries when running inside Linux Docker.
  const isMatchingPlatform = process.platform === platform

  // Local build paths (both dev and prod modes)
  const localToolPathDev = path.join(
    PACKAGE_ROOT,
    '..',
    tool,
    'build',
    'dev',
    'out',
    'Final',
    `${tool}${ext}`,
  )

  const localToolPathProd = path.join(
    PACKAGE_ROOT,
    '..',
    tool,
    'build',
    'prod',
    'out',
    'Final',
    `${tool}${ext}`,
  )

  // Only check local builds when BUILD_TOOLS_FROM_SOURCE=true (building from source inside Docker).
  // When not set, always use downloaded binaries which are built for the correct platform.
  // This prevents using host platform binaries (e.g., macOS) when running in Docker (Linux).
  if (buildToolsFromSource) {
    // Check if the requested platform matches the current runtime platform.
    // Local builds are built for the host platform where the build ran.
    if (isMatchingPlatform) {
      if (existsSync(localToolPathDev)) {
        return localToolPathDev
      }

      if (existsSync(localToolPathProd)) {
        return localToolPathProd
      }
    }

    // BUILD_TOOLS_FROM_SOURCE is set but no compatible local build found - error out
    const reason = isMatchingPlatform
      ? 'not found locally'
      : `local builds are for ${process.platform}, not ${platform}`
    throw new Error(
      `${tool} ${reason} for ${platformArch} and BUILD_TOOLS_FROM_SOURCE=true.\n` +
        `Build ${tool} locally first:\n` +
        `  pnpm --filter build-infra run build:docker --package=${tool} --target=${platformArch}\n` +
        'Or unset BUILD_TOOLS_FROM_SOURCE to allow downloading from releases.',
    )
  }

  // Check downloaded location (platform-specific, safe for cross-platform)
  const buildInfraDir = path.join(PACKAGE_ROOT, '..', 'build-infra')
  const downloadDir = path.join(buildInfraDir, 'build', 'downloaded')
  const downloadedPath = path.join(
    downloadDir,
    tool,
    platformArch,
    `${tool}${ext}`,
  )

  if (existsSync(downloadedPath)) {
    return downloadedPath
  }

  // Download from GitHub releases
  logger.substep(`Downloading ${tool} for ${platformArch}...`)

  const binaryPath = await downloadSocketBtmRelease({
    bin: tool,
    cwd: buildInfraDir,
    downloadDir,
    libc: platform === 'linux' ? libc : undefined,
    removeMacOSQuarantine: true,
    targetArch: arch,
    targetPlatform: platform,
    tool,
  })

  return binaryPath
}

/**
 * Ensure binpress binary is available, downloading if necessary.
 * Downloads binpress from GitHub releases if not found locally.
 *
 * @param {object} options - Options.
 * @param {string} options.hostPlatform - Host platform (where compression runs).
 * @param {string} options.hostArch - Host architecture.
 * @param {string} [options.hostLibc] - Host libc (musl, glibc, or undefined for auto-detect).
 * @param {boolean} [options.silent] - Suppress logging (default: false).
 * @returns {Promise<string>} Path to binpress binary.
 */
export async function ensureBinpress(options) {
  const {
    hostArch = process.arch,
    hostLibc = detectLibc(),
    hostPlatform = process.platform,
    silent = false,
  } = options || {}

  if (!silent) {
    logger.step('Ensuring binpress')
  }

  // Download binpress for host platform (compressor runs on host).
  const binpressPath = await downloadToolIfMissing(
    'binpress',
    hostPlatform,
    hostArch,
    hostLibc,
  )

  if (!silent) {
    const hostPlatformArch = getPlatformArch(hostPlatform, hostArch, hostLibc)
    logger.success(`binpress ready (${hostPlatformArch})`)
    logger.substep(`Path: ${binpressPath}`)
    logger.logNewline()
  }

  return binpressPath
}
