/**
 * Shared utilities for fetching GitHub releases.
 */

import { safeMkdir } from '@socketsecurity/lib/fs'
import { httpDownload, httpRequest } from '@socketsecurity/lib/http-request'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { pRetry } from '@socketsecurity/lib/promises'

const logger = getDefaultLogger()

const OWNER = 'SocketDev'
const REPO = 'socket-btm'

/**
 * Retry configuration for GitHub API requests.
 *
 * Uses exponential backoff to handle transient failures and rate limiting.
 */
const RETRY_CONFIG = Object.freeze({
  __proto__: null,
  // Exponential backoff: delay doubles with each retry (5s, 10s, 20s).
  backoffFactor: 2,
  // Initial delay before first retry.
  baseDelayMs: 5000,
  // Maximum number of retry attempts (excluding initial request).
  retries: 2,
})

/**
 * Get GitHub authentication headers if token is available.
 *
 * This function constructs the necessary headers for GitHub API requests,
 * including authentication if a token is provided via environment variables.
 *
 * Environment Variables:
 * - GH_TOKEN: GitHub Personal Access Token (preferred).
 * - GITHUB_TOKEN: Alternative token environment variable (checked if GH_TOKEN not set).
 *
 * Authentication:
 * - Without token: Unauthenticated requests are subject to GitHub's rate limits
 *   (60 requests per hour per IP address).
 * - With token: Authenticated requests have higher rate limits
 *   (5,000 requests per hour for personal tokens).
 *
 * Required Token Permissions:
 * - For public repositories: No specific permissions required (public access).
 * - For private repositories: 'repo' scope required.
 * - Classic tokens: Use 'repo' scope.
 * - Fine-grained tokens: Use 'Contents' repository permission (read-only).
 *
 * Rate Limits:
 * - Unauthenticated: 60 requests/hour per IP.
 * - Authenticated (personal token): 5,000 requests/hour.
 * - Authenticated (GitHub Actions): 1,000 requests/hour.
 * - Rate limit headers are included in API responses:
 *   - X-RateLimit-Limit: Maximum requests allowed.
 *   - X-RateLimit-Remaining: Requests remaining in current window.
 *   - X-RateLimit-Reset: Unix timestamp when limit resets.
 *
 * Error Codes:
 * - 401: Authentication failed (invalid or expired token).
 * - 403: Rate limit exceeded or insufficient permissions.
 * - 404: Resource not found (or insufficient permissions to view).
 *
 * @returns {object} Headers object with Authorization header if token exists.
 * @returns {string} return.Accept - GitHub API version specification.
 * @returns {string} return['X-GitHub-Api-Version'] - API version date.
 * @returns {string} [return.Authorization] - Bearer token (if available).
 *
 * @example
 * // Without token (unauthenticated)
 * const headers = getAuthHeaders()
 * // { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }
 *
 * @example
 * // With token (authenticated)
 * process.env.GH_TOKEN = 'ghp_abc123'
 * const headers = getAuthHeaders()
 * // {
 * //   Accept: 'application/vnd.github+json',
 * //   'X-GitHub-Api-Version': '2022-11-28',
 * //   Authorization: 'Bearer ghp_abc123'
 * // }
 */
function getAuthHeaders() {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }
  return headers
}

/**
 * Get latest release tag for a tool with retry logic.
 *
 * @param {string} tool - Tool name (e.g., 'lief', 'binpress').
 * @param {object} [options] - Options.
 * @param {boolean} [options.quiet] - Suppress log messages.
 * @returns {Promise<string|null>} - Latest release tag or null if not found.
 */
export async function getLatestRelease(tool, { quiet = false } = {}) {
  return await pRetry(
    async () => {
      const response = await httpRequest(
        `https://api.github.com/repos/${OWNER}/${REPO}/releases?per_page=100`,
        {
          headers: getAuthHeaders(),
        },
      )

      if (!response.ok) {
        throw new Error(`Failed to fetch releases: ${response.status}`)
      }

      const releases = JSON.parse(response.body)

      // Find the first release matching the tool prefix.
      for (const release of releases) {
        const { tag_name: tag } = release
        if (tag.startsWith(`${tool}-`)) {
          if (!quiet) {
            logger.info(`  Found release: ${tag}`)
          }
          return tag
        }
      }

      // No matching release found in the list.
      if (!quiet) {
        logger.info(`  No ${tool} release found in latest 100 releases`)
      }
      return null
    },
    {
      ...RETRY_CONFIG,
      onRetry: (attempt, error) => {
        if (!quiet) {
          logger.info(
            `  Retry attempt ${attempt + 1}/${RETRY_CONFIG.retries + 1} for ${tool} release list...`,
          )
          logger.warn(
            `  Attempt ${attempt + 1}/${RETRY_CONFIG.retries + 1} failed: ${error.message}`,
          )
        }
      },
    },
  )
}

/**
 * Get download URL for a specific release asset.
 *
 * Returns the browser download URL which requires redirect following.
 * For public repositories, this URL returns HTTP 302 redirect to CDN.
 *
 * @param {string} tag - Release tag name.
 * @param {string} assetName - Asset name to download.
 * @param {object} [options] - Options.
 * @param {boolean} [options.quiet] - Suppress log messages.
 * @returns {Promise<string|null>} - Download URL or null if not found.
 */
export async function getReleaseAssetUrl(
  tag,
  assetName,
  { quiet = false } = {},
) {
  return await pRetry(
    async () => {
      const response = await httpRequest(
        `https://api.github.com/repos/${OWNER}/${REPO}/releases/tags/${tag}`,
        {
          headers: getAuthHeaders(),
        },
      )

      if (!response.ok) {
        throw new Error(`Failed to fetch release ${tag}: ${response.status}`)
      }

      const release = JSON.parse(response.body)

      // Find the matching asset.
      const asset = release.assets.find(a => a.name === assetName)

      if (!asset) {
        throw new Error(`Asset ${assetName} not found in release ${tag}`)
      }

      if (!quiet) {
        logger.info(`  Found asset: ${assetName}`)
      }

      return asset.browser_download_url
    },
    {
      ...RETRY_CONFIG,
      onRetry: (attempt, error) => {
        if (!quiet) {
          logger.info(
            `  Retry attempt ${attempt + 1}/${RETRY_CONFIG.retries + 1} for asset URL...`,
          )
          logger.warn(
            `  Attempt ${attempt + 1}/${RETRY_CONFIG.retries + 1} failed: ${error.message}`,
          )
        }
      },
    },
  )
}

/**
 * Download a specific release asset.
 *
 * Uses browser_download_url to avoid consuming GitHub API quota.
 * The httpDownload function from @socketsecurity/lib@5.1.3+ automatically
 * follows HTTP redirects, eliminating the need for Octokit's getReleaseAsset API.
 *
 * @param {string} tag - Release tag name.
 * @param {string} assetName - Asset name to download.
 * @param {string} outputPath - Path to write the downloaded file.
 * @param {object} [options] - Options.
 * @param {boolean} [options.quiet] - Suppress log messages.
 * @returns {Promise<void>}
 */
export async function downloadReleaseAsset(
  tag,
  assetName,
  outputPath,
  { quiet = false } = {},
) {
  const path = await import('node:path')

  // Get the browser_download_url for the asset (doesn't consume API quota for download)
  const downloadUrl = await getReleaseAssetUrl(tag, assetName, { quiet })

  if (!downloadUrl) {
    throw new Error(`Asset ${assetName} not found in release ${tag}`)
  }

  // Create output directory
  await safeMkdir(path.dirname(outputPath))

  // Download using httpDownload which supports redirects and retries
  // This avoids consuming GitHub API quota for the actual download
  await httpDownload(downloadUrl, outputPath, {
    logger: quiet ? undefined : logger,
    progressInterval: 10,
    retries: 2,
    retryDelay: 5000,
  })
}
