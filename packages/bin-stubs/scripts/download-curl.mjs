/**
 * Download prebuilt curl+mbedTLS for stub builds.
 *
 * This is a convenience wrapper around build-curl.mjs exports.
 * All functionality is implemented in build-curl.mjs.
 */

import {
  curlExistsAt,
  downloadCurl,
  ensureCurl,
  getDownloadedCurlDir,
  getLocalCurlDir,
} from './build-curl.mjs'

// Re-export shared functions
export {
  curlExistsAt,
  downloadCurl,
  ensureCurl,
  getDownloadedCurlDir,
  getLocalCurlDir,
}
