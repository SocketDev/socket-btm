/**
 * Hash-based extraction caching utilities.
 *
 * Provides a DRY pattern for build scripts that extract/transform source files.
 * Uses SHA256 content hashing to detect source changes and skip regeneration.
 *
 * @module extraction-cache
 */

import crypto from 'node:crypto'
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

import { safeMkdirSync } from '@socketsecurity/lib/fs'
import loggerPkg from '@socketsecurity/lib/logger'
const { getDefaultLogger } = loggerPkg

const logger = getDefaultLogger()

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
    const existing = readFileSync(outputPath, 'utf8')

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
          `Pattern: ${hashPattern} | Match: ${hashMatch[0] ?? 'undefined'}`,
      )
    }

    // Compute current source hash.
    const currentSourceHash = computeSourceHash(sources)

    // Compare hashes.
    if (cachedSourceHash !== currentSourceHash) {
      return true
    }

    // Cache hit!
    logger.success(`Using cached ${outputPath}`)
    return false
  } catch {
    // Any error, regenerate.
    return true
  }
}

/**
 * Iteratively collect all files from a directory.
 * Uses a stack-based approach to avoid recursion limits on deep directories.
 *
 * Security: Skips symlinks to prevent infinite loops and directory traversal attacks.
 * Error handling: Logs and skips directories with permission errors.
 *
 * @param {string} dirPath - Directory path
 * @returns {string[]} Array of file paths
 */
function collectFiles(dirPath) {
  const files = []
  const stack = [dirPath]

  while (stack.length > 0) {
    const currentDir = stack.pop()
    let entries
    try {
      entries = readdirSync(currentDir, { withFileTypes: true })
    } catch (e) {
      if (e.code === 'EACCES' || e.code === 'EPERM') {
        // Permission denied - log warning and skip this directory
        logger.warn(`Skipping inaccessible directory: ${currentDir}`)
        continue
      }
      if (e.code === 'ENOENT') {
        // Directory was deleted during traversal (TOCTOU race)
        continue
      }
      throw e
    }
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name)
      // Skip symlinks to prevent infinite loops and symlink attacks
      if (entry.isSymbolicLink()) {
        continue
      }
      if (entry.isDirectory()) {
        stack.push(fullPath)
      } else if (entry.isFile()) {
        files.push(fullPath)
      }
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
 * Two usage modes via `options.relativeTo`:
 *   - Omitted: path is hashed as-is (absolute). Use for source-cache hashes
 *     where rename detection across source roots matters — moving foo.ts
 *     between two source roots with unchanged content must change the hash.
 *   - Provided: path is hashed relative to `relativeTo`. Use for artifact-
 *     integrity hashes where the tarball gets extracted to different absolute
 *     paths at creation time (temp dir) vs restore time (final dir). The hash
 *     must stay stable across absolute-path changes, so only content and
 *     intra-artifact layout contribute.
 *
 * @param {string[]} sourcePaths - Source file or directory paths to hash
 * @param {string} [platformMetadata] - Optional platform metadata (e.g., "linux-x64-glibc")
 * @param {object} [options]
 * @param {string} [options.relativeTo] - If set, hash each path relative to this root
 * @returns {string} SHA256 hash (hex)
 */
export function computeSourceHash(sourcePaths, platformMetadata, options) {
  const relativeTo = options?.relativeTo
  // Expand directories to individual files
  const expandedPaths = []
  for (const sourcePath of sourcePaths) {
    try {
      // Use lstatSync to detect symlinks without following them
      const stats = lstatSync(sourcePath)
      // Skip symlinks to prevent security issues
      if (stats.isSymbolicLink()) {
        continue
      }
      if (stats.isDirectory()) {
        // Iteratively collect all files from directory
        const files = collectFiles(sourcePath)
        expandedPaths.push(...files)
      } else {
        expandedPaths.push(sourcePath)
      }
    } catch (e) {
      if (e.code === 'ENOENT') {
        // Missing path - will be handled below with sentinel value
        expandedPaths.push(sourcePath)
      } else {
        throw e
      }
    }
  }

  // Compute the path string that feeds into the hash. For artifact-integrity
  // hashing (relativeTo set), strip the root so absolute-path changes (temp
  // extract dir vs final extract dir) don't affect the digest. Normalize
  // backslashes to forward slashes for cross-platform consistency.
  const pathForHash = absolutePath => {
    const rel = relativeTo
      ? path.relative(relativeTo, absolutePath)
      : absolutePath
    return rel.replace(/\\/g, '/')
  }

  // Sort on the hash-input string (post-normalization) so order is stable
  // regardless of whether `relativeTo` is provided.
  const entries = expandedPaths
    .map(absolutePath => ({ absolutePath, hashPath: pathForHash(absolutePath) }))
    .toSorted((a, b) =>
      a.hashPath < b.hashPath ? -1 : a.hashPath > b.hashPath ? 1 : 0,
    )

  // Hash each file individually (include filename to detect renames that affect ordering)
  const fileHashes = []
  for (const { absolutePath, hashPath } of entries) {
    try {
      // Read as raw bytes. Reading with 'utf8' corrupts binary inputs
      // (tarballs, .node addons, WASM, PNGs) because invalid UTF-8 byte
      // sequences are replaced with U+FFFD (replacement char) — two
      // distinct binaries with differing invalid-UTF-8 bytes would then
      // hash identically. The cache would skip regenerating for real
      // source changes.
      const content = readFileSync(absolutePath)
      // Include the hash-path in the digest: absolute in source-cache mode
      // (renames must change hash), relative in artifact-integrity mode
      // (absolute path varies between creation temp-dir and restore final-dir
      // so must NOT affect hash). Missing-file sentinels use the same
      // hash-path for symmetry.
      // Note: mtime intentionally excluded to avoid git operation sensitivity.
      const hash = crypto.createHash('sha256')
      hash.update(`${hashPath}\n`)
      hash.update(content)
      const fileHash = hash.digest('hex')
      fileHashes.push(fileHash)
    } catch (e) {
      if (e.code === 'ENOENT') {
        // Missing file indicates cache should be invalidated, not a fatal error
        // File deletion is a valid operation (e.g., removing unused patches)
        // Use a sentinel value that will differ from any valid hash
        // Use hash-path (absolute or relative per mode) to avoid collisions
        // when different files with the same basename are missing.
        const sentinelHash = crypto.createHash('sha256')
          .update(`MISSING:${hashPath}`)
          .digest('hex')
        fileHashes.push(sentinelHash)
        continue
      }
      // Re-throw other errors (permission denied, etc.)
      throw e
    }
  }

  // Include platform metadata if provided (for binary checkpoints)
  if (platformMetadata) {
    const metadataHash = crypto.createHash('sha256')
      .update(platformMetadata)
      .digest('hex')
    fileHashes.push(metadataHash)
  }

  // Hash the list of hashes (matching GitHub Actions approach)
  return crypto.createHash('sha256').update(fileHashes.join('\n')).digest('hex')
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
