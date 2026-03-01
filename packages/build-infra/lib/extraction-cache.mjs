/**
 * Hash-based extraction caching utilities.
 *
 * Provides a DRY pattern for build scripts that extract/transform source files.
 * Uses SHA256 content hashing to detect source changes and skip regeneration.
 *
 * @module extraction-cache
 */

import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

import { safeMkdirSync } from '@socketsecurity/lib/fs'
import loggerPkg from '@socketsecurity/lib/logger'
const { getDefaultLogger } = loggerPkg

/**
 * Check if extraction is needed based on source content hash.
 *
 * Compares the SHA256 hash of the source file(s) against the hash
 * stored in the output file. Returns true if extraction is needed.
 *
 * @param {object} options - Extraction cache options
 * @param {string|string[]} options.sourcePaths - Source file path(s) to hash
 * @param {string} options.outputPath - Output file path to check
 * @param {RegExp} options.hashPattern - Pattern to extract hash from output (default: /Source hash: ([a-f0-9]{64})/)
 * @param {function} [options.validateOutput] - Optional function to validate output content
 * @returns {Promise<boolean>} True if extraction needed, false if cached
 */
export async function shouldExtract({
  hashPattern = /Source hash: ([a-f0-9]{64})/,
  outputPath,
  sourcePaths,
  validateOutput,
}) {
  // Normalize to array.
  const sources = Array.isArray(sourcePaths) ? sourcePaths : [sourcePaths]

  // Check if output exists.
  if (!existsSync(outputPath)) {
    return true
  }

  // Check if all sources exist.
  for (const sourcePath of sources) {
    if (!existsSync(sourcePath)) {
      return true
    }
  }

  try {
    const existing = readFileSync(outputPath, 'utf-8')

    // Validate output if validator provided.
    if (validateOutput && !validateOutput(existing)) {
      return true
    }

    // Extract cached hash from output.
    const hashMatch = existing.match(hashPattern)
    if (!hashMatch) {
      return true
    }

    const cachedSourceHash = hashMatch[1]
    if (!cachedSourceHash) {
      // Regex matched but capture group missing - this is a programmer error
      throw new Error(
        'Cache hash pattern matched but capture group is missing. ' +
          `Pattern: ${hashPattern} | Match: ${hashMatch[0]}`,
      )
    }

    // Compute current source hash.
    const currentSourceHash = computeSourceHash(sources)

    // Compare hashes.
    if (cachedSourceHash !== currentSourceHash) {
      return true
    }

    // Cache hit!
    const logger = getDefaultLogger()
    logger.success(`Using cached ${outputPath}`)
    return false
  } catch {
    // Any error, regenerate.
    return true
  }
}

/**
 * Recursively collect all files from a directory.
 *
 * @param {string} dirPath - Directory path
 * @param {string[]} [files=[]] - Accumulator for file paths
 * @returns {string[]} Array of file paths
 */
function collectFilesRecursive(dirPath, files = []) {
  const entries = readdirSync(dirPath, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name)
    if (entry.isDirectory()) {
      collectFilesRecursive(fullPath, files)
    } else if (entry.isFile()) {
      files.push(fullPath)
    }
  }
  return files
}

/**
 * Compute SHA256 hash of source file(s).
 *
 * Matches GitHub Actions cache key algorithm:
 * 1. Hash each file individually (SHA256)
 * 2. Join hashes with newlines
 * 3. Hash the combined result (SHA256)
 *
 * Files are sorted to ensure stable hash values regardless of input order.
 * Supports both individual files and directories (recursively hashes all files within).
 *
 * @param {string[]} sourcePaths - Source file or directory paths to hash
 * @param {string} [platformMetadata] - Optional platform metadata (e.g., "linux-x64-glibc")
 * @returns {string} SHA256 hash (hex)
 */
export function computeSourceHash(sourcePaths, platformMetadata) {
  // Expand directories to individual files
  const expandedPaths = []
  for (const sourcePath of sourcePaths) {
    try {
      const stats = statSync(sourcePath)
      if (stats.isDirectory()) {
        // Recursively collect all files from directory
        const files = collectFilesRecursive(sourcePath)
        expandedPaths.push(...files)
      } else {
        expandedPaths.push(sourcePath)
      }
    } catch (err) {
      if (err.code === 'ENOENT') {
        // Missing path - will be handled below with sentinel value
        expandedPaths.push(sourcePath)
      } else {
        throw err
      }
    }
  }

  // Normalize and sort paths to ensure stable hash regardless of input order or path separators
  // Normalize backslashes to forward slashes for cross-platform consistency
  const sortedPaths = [...expandedPaths].map(p => p.replace(/\\/g, '/')).sort()

  // Hash each file individually (include filename to detect renames that affect ordering)
  const fileHashes = []
  for (const sourcePath of sortedPaths) {
    try {
      const content = readFileSync(sourcePath, 'utf-8')
      // Include basename in hash to detect renames
      // Note: mtime intentionally excluded to avoid git operation sensitivity
      const basename = path.basename(sourcePath)
      const combined = `${basename}\n${content}`
      const fileHash = createHash('sha256').update(combined).digest('hex')
      fileHashes.push(fileHash)
    } catch (err) {
      if (err.code === 'ENOENT') {
        // Missing file indicates cache should be invalidated, not a fatal error
        // File deletion is a valid operation (e.g., removing unused patches)
        // Use a sentinel value that will differ from any valid hash
        // Use basename for cross-platform consistency (avoids path separator differences)
        const basename = path.basename(sourcePath)
        const sentinelHash = createHash('sha256')
          .update(`MISSING:${basename}`)
          .digest('hex')
        fileHashes.push(sentinelHash)
        continue
      }
      // Re-throw other errors (permission denied, etc.)
      throw err
    }
  }

  // Include platform metadata if provided (for binary checkpoints)
  if (platformMetadata) {
    const metadataHash = createHash('sha256')
      .update(platformMetadata)
      .digest('hex')
    fileHashes.push(metadataHash)
  }

  // Hash the list of hashes (matching GitHub Actions approach)
  return createHash('sha256').update(fileHashes.join('\n')).digest('hex')
}

/**
 * Generate source hash comment for embedding in output.
 *
 * @param {string|string[]} sourcePaths - Source file path(s)
 * @returns {string} Comment with hash (e.g., "Source hash: abc123...")
 */
export function generateHashComment(sourcePaths) {
  const sources = Array.isArray(sourcePaths) ? sourcePaths : [sourcePaths]
  const hash = computeSourceHash(sources)
  return `Source hash: ${hash}`
}

/**
 * Ensure output directory exists.
 *
 * @param {string} outputPath - Output file path
 */
export function ensureOutputDir(outputPath) {
  safeMkdirSync(path.dirname(outputPath))
}
