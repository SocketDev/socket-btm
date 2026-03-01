/**
 * Shared utilities for fetching GitHub releases.
 *
 * This module now uses @socketsecurity/lib/releases/github for all GitHub
 * release operations, providing a standardized interface for downloading
 * releases from the SocketDev/socket-btm repository.
 */

import {
  downloadReleaseAsset as downloadReleaseAssetFromLib,
  getLatestRelease as getLatestReleaseFromLib,
  SOCKET_BTM_REPO,
} from '@socketsecurity/lib/releases/github'

/**
 * Get latest release tag for a specific tool.
 *
 * Wrapper around @socketsecurity/lib/releases/github.getLatestRelease
 * that uses the SOCKET_BTM_REPO configuration.
 *
 * @param {string} tool - Tool name (e.g., 'lief', 'binpress').
 * @param {object} [options] - Options.
 * @param {boolean} [options.quiet] - Suppress log messages.
 * @returns {Promise<string|undefined>} - Latest release tag or undefined if not found.
 */
export async function getLatestRelease(tool, { quiet = false } = {}) {
  return await getLatestReleaseFromLib(tool, SOCKET_BTM_REPO, { quiet })
}

/**
 * Download a specific release asset.
 *
 * Wrapper around @socketsecurity/lib/releases/github.downloadGitHubRelease
 * that uses the SOCKET_BTM_REPO configuration.
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
  await downloadReleaseAssetFromLib(
    tag,
    assetName,
    outputPath,
    SOCKET_BTM_REPO,
    { quiet },
  )
}
