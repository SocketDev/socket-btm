/**
 * Utility for fetching and verifying release checksums from GitHub releases.
 *
 * Checksum lookup priority:
 * 1. In-memory cache (fastest, avoids re-parsing)
 * 2. Embedded checksums from release-checksums.json (works offline)
 * 3. Download checksums.txt from GitHub releases (fallback for updates)
 *
 * This hybrid approach provides:
 * - Offline builds with embedded checksums
 * - Automatic updates when connected to network
 * - Consistent verification across all environments
 */

import crypto from 'node:crypto'
import {
  createReadStream,
  existsSync,
  readFileSync,
  promises as fs,
} from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { fileURLToPath } from 'node:url'

import { safeMkdir } from '@socketsecurity/lib/fs'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { getLatestRelease } from '@socketsecurity/lib/releases/github-api'
import { downloadReleaseAsset } from '@socketsecurity/lib/releases/github-downloads'
import { SOCKET_BTM_REPO } from '@socketsecurity/lib/releases/socket-btm'

import { errorMessage } from './error-utils.mts'

const logger = getDefaultLogger()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/** Cache for downloaded checksums by tool and release tag. */
const checksumCache = new Map()

/** Embedded checksums loaded from release-checksums.json (lazy-loaded). */
let embeddedChecksums

/**
 * Load embedded checksums from release-checksums.json.
 * Returns cached result on subsequent calls.
 *
 * @returns {Record<string, {description: string, tag: string, checksums: Record<string, string>}>}
 */
function getEmbeddedChecksums() {
  if (embeddedChecksums === undefined) {
    try {
      const checksumPath = path.join(__dirname, '..', 'release-assets.json')
      embeddedChecksums = JSON.parse(readFileSync(checksumPath, 'utf8'))
    } catch {
      // File not found or invalid JSON - disable embedded checksums.
      embeddedChecksums = undefined
    }
  }
  return embeddedChecksums
}

/**
 * Get embedded checksum for a specific tool and asset.
 *
 * @param {string} tool - Tool name (e.g., 'lief', 'curl').
 * @param {string} assetName - Asset filename.
 * @returns {{checksum: string, tag: string} | undefined} Checksum and release tag if found.
 */
function getEmbeddedChecksum(tool, assetName) {
  const embedded = getEmbeddedChecksums()
  if (!embedded) {
    return undefined
  }
  const toolConfig = embedded[tool]
  if (!toolConfig?.checksums) {
    return undefined
  }
  const checksum = toolConfig.checksums[assetName]
  if (!checksum) {
    return undefined
  }
  return { checksum, tag: toolConfig.tag }
}

/**
 * Compute SHA256 hash of a file.
 *
 * @param {string} filePath - Path to file.
 * @returns {Promise<string>} SHA256 hex digest.
 */
export async function computeFileHash(filePath) {
  const hash = crypto.createHash('sha256')
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
 * Get checksums for a socket-btm release.
 *
 * Lookup priority:
 * 1. In-memory cache (fastest)
 * 2. Embedded checksums from release-checksums.json (works offline)
 * 3. Download checksums.txt from GitHub releases (latest/updated checksums)
 *
 * @param {object} options - Options.
 * @param {string} options.tool - Tool name prefix (e.g., 'lief', 'curl', 'stubs').
 * @param {string} [options.releaseTag] - Optional release tag. If not provided, uses embedded or latest.
 * @param {string} [options.tempDir] - Directory to store downloaded checksums. Defaults to cwd/build/temp.
 * @param {boolean} [options.quiet] - Suppress log messages. Defaults to false.
 * @param {boolean} [options.preferEmbedded] - Prefer embedded checksums over network fetch. Defaults to true.
 * @returns {Promise<{checksums: Record<string, string>, tag: string, source: 'cache'|'embedded'|'network'}>}
 */
export async function getSocketBtmReleaseChecksums(options) {
  const {
    preferEmbedded = true,
    quiet = false,
    releaseTag,
    tempDir,
    tool,
  } = options
  const toolPrefix = `${tool}-`

  // 1. Check in-memory cache first.
  const cacheKey = `${tool}:${releaseTag ?? 'latest'}`
  const cached = checksumCache.get(cacheKey)
  if (cached) {
    return cached
  }

  // 2. Check embedded checksums (works offline).
  const embedded = getEmbeddedChecksums()
  const toolEmbedded = embedded?.[tool]
  if (
    toolEmbedded?.checksums &&
    Object.keys(toolEmbedded.checksums).length > 0
  ) {
    // If no specific tag requested, or tag matches embedded, use embedded.
    if (preferEmbedded && (!releaseTag || releaseTag === toolEmbedded.tag)) {
      const result = {
        checksums: toolEmbedded.checksums,
        source: 'embedded',
        tag: toolEmbedded.tag,
      }
      checksumCache.set(cacheKey, result)
      checksumCache.set(`${tool}:${toolEmbedded.tag}`, result)
      if (!quiet) {
        logger.info(
          `Using embedded checksums for ${tool} (${toolEmbedded.tag})`,
        )
      }
      return result
    }
  }

  // 3. Fall back to network fetch.
  // Resolve release tag if not provided.
  const tag =
    releaseTag ??
    toolEmbedded?.tag ??
    (await getLatestRelease(toolPrefix, SOCKET_BTM_REPO, { quiet: true }))
  if (!tag) {
    if (!quiet) {
      logger.warn(`No ${tool} release found, cannot fetch checksums`)
    }
    return { checksums: {}, source: 'network', tag: '' }
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
      const result = { checksums, source: 'network', tag }
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

    const result = { checksums, source: 'network', tag }
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
  } catch (e) {
    // If network fetch fails, try embedded as last resort.
    if (
      toolEmbedded?.checksums &&
      Object.keys(toolEmbedded.checksums).length > 0
    ) {
      if (!quiet) {
        logger.warn(
          `Network fetch failed, using embedded checksums for ${tool}: ${errorMessage(e)}`,
        )
      }
      const result = {
        checksums: toolEmbedded.checksums,
        source: 'embedded',
        tag: toolEmbedded.tag,
      }
      checksumCache.set(cacheKey, result)
      return result
    }

    if (!quiet) {
      logger.warn(
        `Failed to download checksums.txt for ${tool}: ${errorMessage(e)}`,
      )
    }
    return { checksums: {}, source: 'network', tag }
  }
}

/**
 * Verify a downloaded file against embedded release checksums.
 *
 * Embedded checksums in release-assets.json are the source of truth.
 * If checksums exist for the tool but not the asset, verification fails
 * (run 'pnpm --filter build-infra update-checksums' to update).
 *
 * @param {object} options - Options.
 * @param {string} options.filePath - Path to the downloaded file.
 * @param {string} options.assetName - Asset name to look up in checksums.
 * @param {string} options.tool - Tool name prefix for fetching checksums.
 * @param {boolean} [options.quiet] - Suppress log messages.
 * @returns {Promise<{valid: boolean, expected?: string, actual?: string, skipped?: boolean, source?: string}>}
 */
export async function verifyReleaseChecksum(options) {
  const { assetName, filePath, quiet = false, tool } = options

  // Embedded checksums are the source of truth.
  const embedded = getEmbeddedChecksum(tool, assetName)
  if (embedded) {
    const actual = await computeFileHash(filePath)
    if (actual !== embedded.checksum) {
      return {
        actual,
        expected: embedded.checksum,
        source: 'embedded',
        valid: false,
      }
    }
    return {
      actual,
      expected: embedded.checksum,
      source: 'embedded',
      valid: true,
    }
  }

  // Embedded checksums exist for this tool but not this asset — reject.
  const embeddedData = getEmbeddedChecksums()
  if (
    embeddedData?.[tool]?.checksums &&
    Object.keys(embeddedData[tool].checksums).length > 0
  ) {
    if (!quiet) {
      logger.fail(
        `No embedded checksum for ${assetName} in release-assets.json (tool: ${tool})`,
      )
      logger.fail(`Run 'pnpm --filter build-infra update-checksums' to update`)
    }
    return { source: 'embedded', valid: false }
  }

  // No embedded checksums at all for this tool — skip verification.
  if (!quiet) {
    logger.warn(`No checksums found for ${tool}, skipping verification`)
  }
  return { skipped: true, valid: true }
}

/**
 * Clear the checksum cache. Useful for testing or forcing re-download.
 */
export function clearChecksumCache() {
  checksumCache.clear()
}
