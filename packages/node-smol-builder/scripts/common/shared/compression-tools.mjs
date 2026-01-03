/**
 * @fileoverview Shared helpers for compression tool verification.
 * Provides DRY utilities for checking binpress/binflate tool availability.
 */

import { existsSync } from 'node:fs'
import path from 'node:path'

import { printError } from 'build-infra/lib/build-output'
import { getPlatformArch } from 'build-infra/lib/platform-mappings'

import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { PACKAGE_ROOT } from '../../paths.mjs'

const logger = getDefaultLogger()

/**
 * Get platform-arch-libc string for tool paths.
 * Wrapper around shared getPlatformArch for consistency.
 *
 * @param {string} platform - Platform (darwin, linux, win32).
 * @param {string} arch - Architecture (arm64, x64, ia32).
 * @param {string|null} [libc] - C library variant (musl, glibc, or null).
 * @returns {string} Platform-arch string (e.g., 'linux-x64', 'linux-x64-musl').
 */
function getToolPlatformArch(platform, arch, libc = null) {
  return getPlatformArch(platform, arch, libc)
}

/**
 * Get tool directory for downloaded binaries.
 * Tools are downloaded to: packages/node-smol-builder/build/{tool}/{platform}-{arch}[-musl]/
 */
function getToolDir(toolName, platform, arch, libc = null) {
  const platformArch = getToolPlatformArch(platform, arch, libc)
  return path.join(PACKAGE_ROOT, 'build', toolName, platformArch)
}

/**
 * Get tool binary path.
 */
function getToolPath(toolName, platform, arch, libc = null) {
  const ext = platform === 'win32' ? '.exe' : ''
  return path.join(
    getToolDir(toolName, platform, arch, libc),
    `${toolName}${ext}`,
  )
}

/**
 * Verify compression tools exist (downloaded by workflow).
 * Does NOT build from source - prebuilt binaries must be downloaded first.
 *
 * @param {object} options - Verification options
 * @param {string} options.hostPlatform - Host platform (where compression runs)
 * @param {string} options.hostArch - Host architecture
 * @param {string|null} [options.hostLibc] - Host libc (musl, glibc, or null for auto-detect)
 * @param {string} [options.targetPlatform] - Target platform (for decompressor, defaults to host)
 * @param {string} [options.targetArch] - Target architecture (for decompressor, defaults to host)
 * @param {string|null} [options.targetLibc] - Target libc (musl, glibc, or null)
 * @param {boolean} [options.silent] - Suppress logging (default: false)
 * @returns {object} { compressorPath, decompressorPath, compressorExists, decompressorExists }
 */
export function verifyCompressionTools(options) {
  const {
    hostPlatform,
    hostArch,
    hostLibc = null,
    silent = false,
    targetArch = hostArch,
    targetPlatform = hostPlatform,
    targetLibc = null,
  } = options

  // Validate libc parameters
  if (hostLibc && hostLibc !== 'musl' && hostLibc !== 'glibc') {
    throw new Error(`Invalid hostLibc: ${hostLibc}. Valid options: musl, glibc`)
  }
  if (hostLibc && hostPlatform !== 'linux') {
    throw new Error(
      `hostLibc parameter is only valid for Linux platform (got platform: ${hostPlatform})`,
    )
  }
  if (targetLibc && targetLibc !== 'musl' && targetLibc !== 'glibc') {
    throw new Error(
      `Invalid targetLibc: ${targetLibc}. Valid options: musl, glibc`,
    )
  }
  if (targetLibc && targetPlatform !== 'linux') {
    throw new Error(
      `targetLibc parameter is only valid for Linux platform (got platform: ${targetPlatform})`,
    )
  }

  if (!silent) {
    logger.step('Checking Compression Tools')
  }

  // Compression tools (binpress) run on HOST platform.
  const compressorPath = getToolPath(
    'binpress',
    hostPlatform,
    hostArch,
    hostLibc,
  )
  const compressorExists = existsSync(compressorPath)

  // Decompressor (binflate) must be available for TARGET platform (bundled with binary).
  const decompressorPath = getToolPath(
    'binflate',
    targetPlatform,
    targetArch,
    targetLibc,
  )
  const decompressorExists = existsSync(decompressorPath)

  if (compressorExists && decompressorExists) {
    if (!silent) {
      const hostPlatformArch = getToolPlatformArch(
        hostPlatform,
        hostArch,
        hostLibc,
      )
      const targetPlatformArch = getToolPlatformArch(
        targetPlatform,
        targetArch,
        targetLibc,
      )
      const isCrossCompile = hostPlatformArch !== targetPlatformArch

      if (isCrossCompile) {
        logger.success(
          `Compression tools found (host: ${hostPlatformArch}, target: ${targetPlatformArch})`,
        )
      } else {
        logger.success(`Compression tools found (${hostPlatformArch})`)
      }
      logger.substep(`Compressor: ${compressorPath}`)
      logger.substep(`Decompressor: ${decompressorPath}`)
      logger.logNewline()
    }
    return {
      compressorExists,
      compressorPath,
      decompressorExists,
      decompressorPath,
    }
  }

  // Tools must be downloaded by the workflow.
  // Building from source is not supported for node-smol builds.
  const missingTools = []
  if (!compressorExists) {
    const hostPlatformArch = getToolPlatformArch(
      hostPlatform,
      hostArch,
      hostLibc,
    )
    missingTools.push(`binpress (host ${hostPlatformArch}): ${compressorPath}`)
  }
  if (!decompressorExists) {
    const targetPlatformArch = getToolPlatformArch(
      targetPlatform,
      targetArch,
      targetLibc,
    )
    missingTools.push(
      `binflate (target ${targetPlatformArch}): ${decompressorPath}`,
    )
  }

  printError(
    'Compression Tools Not Found',
    'Prebuilt compression tools must be downloaded from GitHub releases',
    [
      'Missing tools:',
      ...missingTools.map(tool => `  - ${tool}`),
      '',
      'Download prebuilt binaries:',
      '  node packages/node-smol-builder/scripts/download-binsuite-tools.mjs',
    ],
  )
  throw new Error(
    'Compression tools not found. Download prebuilt binaries from releases.',
  )
}

/**
 * Detect if running on musl libc (Alpine Linux).
 */
function detectHostLibc() {
  if (process.platform !== 'linux') {
    return null
  }

  // Check for Alpine release file.
  if (existsSync('/etc/alpine-release')) {
    return 'musl'
  }

  // Check ldd version for musl.
  try {
    const { execSync } = require('node:child_process')
    const lddVersion = execSync('ldd --version 2>&1', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    return lddVersion.includes('musl') ? 'musl' : null
  } catch {
    return null
  }
}

/**
 * Verify compression tools for current platform (simple wrapper).
 * Auto-detects host libc when running on Linux.
 *
 * @param {object} [options] - Optional target platform options.
 * @param {string} [options.targetPlatform] - Target platform (defaults to host).
 * @param {string} [options.targetArch] - Target architecture (defaults to host).
 * @param {string|null} [options.targetLibc] - Target libc (musl, glibc, or null).
 */
export function ensureCompressionTools(options = {}) {
  const {
    targetArch = process.arch,
    targetLibc = null,
    targetPlatform = process.platform,
  } = options

  // Auto-detect host libc on Linux.
  const hostLibc = detectHostLibc()

  return verifyCompressionTools({
    hostArch: process.arch,
    hostLibc,
    hostPlatform: process.platform,
    targetArch,
    targetLibc,
    targetPlatform,
  })
}
