/**
 * Utility for fetching and verifying release checksums from GitHub releases.
 * Dynamically downloads checksums.txt from releases instead of hardcoding.
 */

import { createHash } from 'node:crypto'
import { createReadStream, existsSync, promises as fs } from 'node:fs'
import path from 'node:path'

import { safeMkdir } from '@socketsecurity/lib/fs'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import {
  downloadReleaseAsset,
  getLatestRelease,
  SOCKET_BTM_REPO,
} from '@socketsecurity/lib/releases/github'

const logger = getDefaultLogger()

/** Cache for downloaded checksums by tool and release tag. */
const checksumCache = new Map()

/**
 * Compute SHA256 hash of a file.
 *
 * @param {string} filePath - Path to file.
 * @returns {Promise<string>} SHA256 hex digest.
 */
export async function computeFileHash(filePath) {
  const hash = createHash('sha256')
  const stream = createReadStream(filePath)
  for await (const chunk of stream) {
    hash.update(chunk)
  }
  return hash.digest('hex')
}

/**
 * Parse checksums.txt content into a map.
 * Supports standard format: "hash  filename" (two spaces or whitespace between).
 *
 * @param {string} content - Raw checksums.txt content.
 * @returns {Record<string, string>} Map of filename to SHA256 checksum.
 */
export function parseChecksums(content) {
  const checksums = { __proto__: null }
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) {
      continue
    }
    // Format: hash  filename (two spaces or whitespace between)
    const match = trimmed.match(/^([a-f0-9]{64})\s+(.+)$/)
    if (match) {
      checksums[match[2]] = match[1]
    }
  }
  return checksums
}

/**
 * Download and parse checksums.txt from a socket-btm GitHub release.
 *
 * @param {object} options - Options.
 * @param {string} options.tool - Tool name prefix (e.g., 'lief', 'curl', 'stubs').
 * @param {string} [options.releaseTag] - Optional release tag. If not provided, uses latest.
 * @param {string} [options.tempDir] - Directory to store downloaded checksums. Defaults to cwd/build/temp.
 * @param {boolean} [options.quiet] - Suppress log messages. Defaults to false.
 * @returns {Promise<{checksums: Record<string, string>, tag: string}>} Checksums map and resolved tag.
 */
export async function getSocketBtmReleaseChecksums(options) {
  const { quiet = false, releaseTag, tempDir, tool } = options
  const toolPrefix = `${tool}-`

  // Check cache first.
  const cacheKey = `${tool}:${releaseTag ?? 'latest'}`
  const cached = checksumCache.get(cacheKey)
  if (cached) {
    return cached
  }

  // Resolve release tag if not provided.
  const tag =
    releaseTag ??
    (await getLatestRelease(toolPrefix, SOCKET_BTM_REPO, { quiet: true }))
  if (!tag) {
    if (!quiet) {
      logger.warn(`No ${tool} release found, cannot fetch checksums`)
    }
    return { checksums: {}, tag: '' }
  }

  // Check if we have cached result for this specific tag.
  const tagCacheKey = `${tool}:${tag}`
  const tagCached = checksumCache.get(tagCacheKey)
  if (tagCached) {
    // Also cache under 'latest' key if that's what was requested.
    if (!releaseTag) {
      checksumCache.set(cacheKey, tagCached)
    }
    return tagCached
  }

  // Download checksums.txt to temp file.
  const resolvedTempDir = tempDir ?? path.join(process.cwd(), 'build', 'temp')
  await safeMkdir(resolvedTempDir)
  const checksumPath = path.join(
    resolvedTempDir,
    `${tool}-checksums-${tag}.txt`,
  )

  // Check if already downloaded.
  if (existsSync(checksumPath)) {
    try {
      const content = await fs.readFile(checksumPath, 'utf8')
      const checksums = parseChecksums(content)
      const result = { checksums, tag }
      checksumCache.set(tagCacheKey, result)
      if (!releaseTag) {
        checksumCache.set(cacheKey, result)
      }
      return result
    } catch {
      // Fall through to download.
    }
  }

  try {
    if (!quiet) {
      logger.info(`Downloading checksums for ${tool} release ${tag}...`)
    }
    await downloadReleaseAsset(
      tag,
      'checksums.txt',
      checksumPath,
      SOCKET_BTM_REPO,
      { quiet: true },
    )

    const content = await fs.readFile(checksumPath, 'utf8')
    const checksums = parseChecksums(content)

    const result = { checksums, tag }
    checksumCache.set(tagCacheKey, result)
    if (!releaseTag) {
      checksumCache.set(cacheKey, result)
    }

    if (!quiet) {
      logger.info(
        `Loaded ${Object.keys(checksums).length} checksums for ${tool}`,
      )
    }
    return result
  } catch (error) {
    if (!quiet) {
      logger.warn(
        `Failed to download checksums.txt for ${tool}: ${error.message}`,
      )
    }
    return { checksums: {}, tag }
  }
}

/**
 * Verify a downloaded file against release checksums.
 *
 * @param {object} options - Options.
 * @param {string} options.filePath - Path to the downloaded file.
 * @param {string} options.assetName - Asset name to look up in checksums.
 * @param {string} options.tool - Tool name prefix for fetching checksums.
 * @param {string} [options.releaseTag] - Optional release tag.
 * @param {string} [options.tempDir] - Directory for temp files.
 * @param {boolean} [options.quiet] - Suppress log messages.
 * @returns {Promise<{valid: boolean, expected?: string, actual?: string, skipped?: boolean}>}
 */
export async function verifyReleaseChecksum(options) {
  const {
    assetName,
    filePath,
    quiet = false,
    releaseTag,
    tempDir,
    tool,
  } = options

  const { checksums } = await getSocketBtmReleaseChecksums({
    tool,
    releaseTag,
    tempDir,
    quiet: true,
  })

  const expected = checksums[assetName]
  if (!expected) {
    if (!quiet) {
      logger.warn(`No checksum found for ${assetName}, skipping verification`)
    }
    return { valid: true, skipped: true }
  }

  const actual = await computeFileHash(filePath)
  if (actual !== expected) {
    return { valid: false, expected, actual }
  }

  return { valid: true, expected, actual }
}

/**
 * Clear the checksum cache. Useful for testing or forcing re-download.
 */
export function clearChecksumCache() {
  checksumCache.clear()
}
