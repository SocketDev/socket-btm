/**
 * File download utility with automatic progress tracking.
 * Wraps @socketsecurity/lib's httpDownload for build infrastructure use.
 */

import { httpDownload } from '@socketsecurity/lib/http-request'
import { getDefaultLogger } from '@socketsecurity/lib/logger'

const logger = getDefaultLogger()

/**
 * Download a file from a URL with automatic progress logging.
 *
 * @param {string} url - URL to download from
 * @param {string} destPath - Destination file path
 * @param {object} [options] - Download options
 * @param {number} [options.progressInterval=10] - Progress reporting frequency (percentage)
 * @param {number} [options.timeout=300000] - Request timeout in ms (default: 5 minutes)
 * @param {boolean} [options.silent=false] - Suppress progress logs
 * @returns {Promise<void>}
 * @throws {Error} On download failure
 *
 * @example
 * await downloadWithProgress(
 *   'https://github.com/org/repo/releases/download/v1.0.0/binary.tar.gz',
 *   '/tmp/binary.tar.gz'
 * )
 */
export async function downloadWithProgress(url, destPath, options = {}) {
  const { progressInterval = 10, silent = false, timeout = 300_000 } = options

  if (!silent) {
    logger.substep(`Downloading: ${url}`)
  }

  await httpDownload(url, destPath, {
    logger: silent ? undefined : logger,
    progressInterval,
    timeout,
  })

  if (!silent) {
    logger.success(`Downloaded: ${destPath}`)
  }
}
