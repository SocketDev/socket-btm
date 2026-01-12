/**
 * Shared platform and architecture mappings for GitHub release assets.
 *
 * Maps Node.js platform/architecture names to release asset naming conventions.
 * Used consistently across all download and build scripts to avoid duplication.
 */

/**
 * Maps Node.js platform names to GitHub release platform names.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const RELEASE_PLATFORM_MAP = Object.freeze({
  __proto__: null,
  darwin: 'darwin',
  linux: 'linux',
  win32: 'win',
})

/**
 * Maps Node.js architecture names to GitHub release architecture names.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const RELEASE_ARCH_MAP = Object.freeze({
  __proto__: null,
  arm64: 'arm64',
  ia32: 'x86',
  x64: 'x64',
})

/**
 * Get platform-arch string for internal directory paths (download locations).
 * Uses Node.js platform naming directly (win32, darwin, linux).
 *
 * @param {string} platform - Node.js platform (darwin, linux, win32).
 * @param {string} arch - Node.js architecture (arm64, x64, ia32).
 * @param {string|null} [libc] - C library variant (musl, glibc) - Linux only.
 * @returns {string} Platform-arch string (e.g., 'win32-x64', 'linux-x64-musl').
 * @throws {Error} If platform/arch is unsupported.
 */
export function getPlatformArch(platform, arch, libc) {
  const releaseArch = RELEASE_ARCH_MAP[arch]

  if (!releaseArch) {
    throw new Error(`Unsupported arch: ${arch}`)
  }
  if (platform !== 'darwin' && platform !== 'linux' && platform !== 'win32') {
    throw new Error(`Unsupported platform: ${platform}`)
  }

  // Validate libc parameter.
  if (libc && libc !== 'musl' && libc !== 'glibc') {
    throw new Error(`Invalid libc: ${libc}. Valid options: musl, glibc`)
  }
  if (libc && platform !== 'linux') {
    throw new Error(
      `libc parameter is only valid for Linux platform (got platform: ${platform})`,
    )
  }

  // Add musl suffix for Linux musl builds.
  const muslSuffix = platform === 'linux' && libc === 'musl' ? '-musl' : ''
  // Use Node.js platform naming directly for directory paths
  return `${platform}-${releaseArch}${muslSuffix}`
}

/**
 * Get platform-arch string for GitHub release asset naming.
 * Uses shortened platform names (win instead of win32).
 *
 * @param {string} platform - Node.js platform (darwin, linux, win32).
 * @param {string} arch - Node.js architecture (arm64, x64, ia32).
 * @param {string|null} [libc] - C library variant (musl, glibc) - Linux only.
 * @returns {string} Platform-arch string for assets (e.g., 'win-x64', 'linux-x64-musl').
 * @throws {Error} If platform/arch is unsupported.
 */
export function getAssetPlatformArch(platform, arch, libc) {
  const releasePlatform = RELEASE_PLATFORM_MAP[platform]
  const releaseArch = RELEASE_ARCH_MAP[arch]

  if (!releasePlatform || !releaseArch) {
    throw new Error(`Unsupported platform/arch: ${platform}/${arch}`)
  }

  // Validate libc parameter.
  if (libc && libc !== 'musl' && libc !== 'glibc') {
    throw new Error(`Invalid libc: ${libc}. Valid options: musl, glibc`)
  }
  if (libc && platform !== 'linux') {
    throw new Error(
      `libc parameter is only valid for Linux platform (got platform: ${platform})`,
    )
  }

  // Add musl suffix for Linux musl builds.
  const muslSuffix = platform === 'linux' && libc === 'musl' ? '-musl' : ''
  // Use shortened platform names for asset names
  return `${releasePlatform}-${releaseArch}${muslSuffix}`
}
