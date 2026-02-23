/**
 * Generate cache keys with version and content hash for proper invalidation.
 *
 * Cache directory format: v{nodeVersion}-{platform}-{arch}-{contentHash}-{pkgVersion}
 * Example: v24.12.0-darwin-arm64-b71671ba-2.1.5
 *
 * Platform and arch should be specified explicitly for cross-compilation builds.
 * Defaults to current system values if not provided.
 *
 * Cache-busting dependencies:
 * - Bootstrap: @socketsecurity/lib, @socketsecurity/packageurl-js
 * - CLI: @socketsecurity/lib, @socketsecurity/packageurl-js, @socketsecurity/sdk, @socketsecurity/registry
 * - CLI-with-sentry: @socketsecurity/lib, @socketsecurity/packageurl-js
 */

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import process from 'node:process'

/**
 * Critical dependencies that trigger cache invalidation.
 * When these packages are updated, caches must be rebuilt.
 */
const CACHE_BUSTING_DEPS = {
  bootstrap: ['@socketsecurity/lib', '@socketsecurity/packageurl-js'],
  cli: [
    '@socketsecurity/lib',
    '@socketsecurity/packageurl-js',
    '@socketsecurity/sdk',
    '@socketsecurity/registry',
  ],
  'cli-with-sentry': ['@socketsecurity/lib', '@socketsecurity/packageurl-js'],
}

/**
 * Get dependency versions from package.json.
 *
 * @param {string} packageJsonPath - Path to package.json
 * @param {string[]} depNames - Dependency names to extract
 * @returns {Record<string, string>} Dependency versions
 */
function getDependencyVersions(packageJsonPath, depNames) {
  let content
  try {
    content = readFileSync(packageJsonPath, 'utf8')
  } catch (err) {
    throw new Error(
      `Failed to read package.json at ${packageJsonPath}: ${err.message}`,
    )
  }

  let packageJson
  try {
    packageJson = JSON.parse(content)
  } catch (err) {
    throw new Error(
      `Failed to parse package.json at ${packageJsonPath}: ${err.message}`,
    )
  }

  const versions = {}
  for (const depName of depNames) {
    const version =
      packageJson.dependencies?.[depName] ||
      packageJson.devDependencies?.[depName]
    if (version) {
      versions[depName] = version
    }
  }

  return versions
}

/**
 * Generate a cache key for a package build.
 *
 * @param {object} options
 * @param {string} options.nodeVersion - Node.js version (e.g., '24.12.0')
 * @param {string} [options.platform] - Platform (e.g., 'darwin', 'linux', 'win32') - defaults to current
 * @param {string} [options.arch] - Architecture (e.g., 'arm64', 'x64') - defaults to current
 * @param {string} options.packageVersion - Package version from package.json
 * @param {string} [options.packageName] - Package name for dependency tracking (e.g., 'bootstrap', 'cli')
 * @param {string} [options.packageJsonPath] - Path to package.json for dependency resolution
 * @param {string[]} [options.contentFiles] - Files to hash for content-based invalidation
 * @param {string[]} [options.cacheBustingDeps] - Override cache-busting dependencies
 * @returns {string} Cache key
 */
export function generateCacheKey({
  arch: targetArch = process.arch,
  cacheBustingDeps,
  contentFiles = [],
  nodeVersion,
  packageJsonPath,
  packageName,
  packageVersion,
  platform: targetPlatform = process.platform,
}) {
  // Hash content files.
  const hash = createHash('sha256')

  for (const file of contentFiles) {
    try {
      const content = readFileSync(file, 'utf8')
      hash.update(content)
    } catch (err) {
      // Only handle ENOENT silently - file deletion is intentional
      if (err.code === 'ENOENT') {
        // File doesn't exist - use filename in hash.
        hash.update(file)
        continue
      }
      // All other errors indicate a problem that should fail the build
      throw new Error(
        `Failed to read cache key source file '${file}': ${err.message} (${err.code})`,
      )
    }
  }

  // Include cache-busting dependency versions.
  const depsToCheck =
    cacheBustingDeps ||
    (packageName ? CACHE_BUSTING_DEPS[packageName] : undefined)
  if (depsToCheck && packageJsonPath) {
    const depVersions = getDependencyVersions(packageJsonPath, depsToCheck)
    // Sort for consistent hashing.
    const sortedDeps = Object.keys(depVersions).sort()
    for (const dep of sortedDeps) {
      hash.update(`${dep}@${depVersions[dep]}`)
    }
  }

  const contentHash = hash.digest('hex').slice(0, 16)

  // Format: v{nodeVersion}-{platform}-{arch}-{contentHash}-{componentLengths}.{pkgVersion}
  // Platform and arch default to current system values
  // Store component lengths to enable accurate version reconstruction (supports multi-digit versions like "2.10.5")
  const versionParts = packageVersion.split('.')
  // Validate version format before generating cache key
  if (versionParts.length === 0 || versionParts.some(p => p.length === 0)) {
    throw new Error(
      `Invalid package version format: "${packageVersion}". ` +
        'Expected semver format (e.g., "2.1.5" or "1.0.0")',
    )
  }
  const componentLengths = versionParts.map(p => p.length).join(',')
  const versionDigits = packageVersion.replace(/\./g, '')
  return `v${nodeVersion}-${targetPlatform}-${targetArch}-${contentHash}-${componentLengths}.${versionDigits}`
}

/**
 * Parse a cache key to extract components.
 *
 * @param {string} cacheKey
 * @returns {object|undefined}
 */
export function parseCacheKey(cacheKey) {
  // Format: v{nodeVersion}-{platform}-{arch}-{contentHash}-{componentLengths}.{pkgVersion}
  // contentHash is exactly 16 hex characters
  const match = cacheKey.match(
    /^v([\d.]+)-(\w+)-(\w+)-([a-f0-9]{16})-([\d,]+)\.(\d+)$/,
  )
  if (!match) {
    return undefined
  }

  const componentLengthStr = match[5]
  const versionDigits = match[6]

  // Handle empty component lengths (edge case)
  if (!componentLengthStr || componentLengthStr === '') {
    // Empty component lengths with non-empty digits is invalid
    if (versionDigits.length > 0) {
      return undefined
    }
    // Empty component lengths with empty digits is valid (empty version)
    return {
      nodeVersion: match[1],
      platform: match[2],
      arch: match[3],
      contentHash: match[4],
      packageVersion: '',
    }
  }

  const componentLengths = componentLengthStr.split(',').map(Number)

  // Validate all component lengths are valid positive numbers (reject zero-length components)
  // Also reject unreasonably large component lengths (DoS prevention)
  const MAX_COMPONENT_LENGTH = 10
  if (
    componentLengths.some(
      len => !Number.isFinite(len) || len <= 0 || len > MAX_COMPONENT_LENGTH,
    )
  ) {
    return undefined
  }

  // Reconstruct version using component lengths
  const parts = []
  let offset = 0
  for (const len of componentLengths) {
    if (offset + len > versionDigits.length) {
      // Invalid cache key - component lengths don't match digits
      return undefined
    }
    parts.push(versionDigits.substring(offset, offset + len))
    offset += len
  }

  // Verify we consumed all digits
  if (offset !== versionDigits.length) {
    return undefined
  }

  const packageVersion = parts.join('.')

  return {
    nodeVersion: match[1],
    platform: match[2],
    arch: match[3],
    contentHash: match[4],
    packageVersion,
  }
}

/**
 * Check if a cache key is still valid.
 *
 * @param {string} cacheKey
 * @param {object} currentOptions - Current build options (same as generateCacheKey)
 * @returns {boolean}
 */
export function isCacheValid(cacheKey, currentOptions) {
  const parsed = parseCacheKey(cacheKey)
  if (!parsed) {
    return false
  }

  const currentKey = generateCacheKey(currentOptions)
  return cacheKey === currentKey
}
