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
import { platform, arch } from 'node:process'

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
  try {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
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
  } catch {
    return {}
  }
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
  arch: targetArch = arch,
  cacheBustingDeps,
  contentFiles = [],
  nodeVersion,
  packageJsonPath,
  packageName,
  packageVersion,
  platform: targetPlatform = platform,
}) {
  // Hash content files.
  const hash = createHash('sha256')

  for (const file of contentFiles) {
    try {
      const content = readFileSync(file, 'utf8')
      hash.update(content)
    } catch {
      // File doesn't exist - use filename in hash.
      hash.update(file)
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

  const contentHash = hash.digest('hex').slice(0, 8)

  // Format: v{nodeVersion}-{platform}-{arch}-{contentHash}-{dotCount}.{pkgVersion}
  // Platform and arch default to current system values
  // Store dot count to enable accurate version reconstruction
  const dotCount = (packageVersion.match(/\./g) || []).length
  const versionDigits = packageVersion.replace(/\./g, '')
  return `v${nodeVersion}-${targetPlatform}-${targetArch}-${contentHash}-${dotCount}.${versionDigits}`
}

/**
 * Parse a cache key to extract components.
 *
 * @param {string} cacheKey
 * @returns {object|undefined}
 */
export function parseCacheKey(cacheKey) {
  // Format: v{nodeVersion}-{platform}-{arch}-{contentHash}-{dotCount}.{pkgVersion}
  const match = cacheKey.match(
    /^v([\d.]+)-(\w+)-(\w+)-([a-f0-9]+)-(\d+)\.(\d+)$/,
  )
  if (!match) {
    // Fall back to old format for backward compatibility
    const oldMatch = cacheKey.match(/^v([\d.]+)-(\w+)-(\w+)-([a-f0-9]+)-(\d+)$/)
    if (oldMatch) {
      return {
        nodeVersion: oldMatch[1],
        platform: oldMatch[2],
        arch: oldMatch[3],
        contentHash: oldMatch[4],
        // Best-effort restoration for old format (works only for 3-digit versions)
        packageVersion: oldMatch[5].replace(/(\d)(\d)(\d)/, '$1.$2.$3'),
      }
    }
    return undefined
  }

  const dotCount = Number.parseInt(match[5], 10)
  const versionDigits = match[6]

  // Reconstruct version by inserting dots at correct positions
  let packageVersion = versionDigits
  if (dotCount > 0 && versionDigits.length > dotCount) {
    const parts = []
    let remaining = versionDigits
    // Insert dots to create dotCount+1 parts
    for (let i = 0; i < dotCount; i++) {
      // Take one digit for each part except the last
      parts.push(remaining[0])
      remaining = remaining.slice(1)
    }
    // Last part gets all remaining digits
    parts.push(remaining)
    packageVersion = parts.join('.')
  }

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
