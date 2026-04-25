'use strict'

// Pre-formatted common HTTP headers for zero-allocation responses.
// Used by registry endpoints to avoid string concatenation overhead.

const commonHeaders = {
  __proto__: null,

  // Content-Type headers (most common in registry).
  'application/json': 'Content-Type: application/json\r\n',
  'application/octet-stream': 'Content-Type: application/octet-stream\r\n',
  'text/plain': 'Content-Type: text/plain\r\n',

  // Connection headers.
  'keep-alive': 'Connection: keep-alive\r\n',
  close: 'Connection: close\r\n',

  // Cache-Control headers (common in registry responses).
  'public, max-age=300': 'Cache-Control: public, max-age=300\r\n',
  'public, max-age=3600': 'Cache-Control: public, max-age=3600\r\n',
  'no-cache': 'Cache-Control: no-cache\r\n',

  // Transfer-Encoding.
  chunked: 'Transfer-Encoding: chunked\r\n',

  // CORS headers (if needed).
  '*': 'Access-Control-Allow-Origin: *\r\n',
}

// Pre-formatted status lines for instant response start.
const statusLines = {
  __proto__: null,
  200: 'HTTP/1.1 200 OK\r\n',
  304: 'HTTP/1.1 304 Not Modified\r\n',
  404: 'HTTP/1.1 404 Not Found\r\n',
  500: 'HTTP/1.1 500 Internal Server Error\r\n',
}

// Get pre-formatted header string.
function getHeader(key, value) {
  const cacheKey = typeof value === 'string' ? value : key
  return commonHeaders[cacheKey]
}

// Get pre-formatted status line.
function getStatusLine(statusCode) {
  return statusLines[statusCode]
}

// Build Content-Length header (common sizes cached).
const contentLengthCache = {
  __proto__: null,
}

// Pre-cache common registry response sizes.
const commonSizes = [
  0, 1, 2, 3, 4, 5, 10, 20, 50, 100, 200, 500, 1000, 1024, 2048, 4096, 8192,
  10240, 16384, 32768, 65536,
]

for (let i = 0; i < commonSizes.length; i++) {
  const size = commonSizes[i]
  contentLengthCache[size] = `Content-Length: ${size}\r\n`
}

// Cap dynamic entries so pathological callers can't grow the cache without bound.
// `commonSizes` entries (22 pre-cached) are always retained because we never
// evict keys whose numeric value is in the pre-cached set.
const MAX_DYNAMIC_ENTRIES = 512

let dynamicEntryCount = 0

function getContentLength(length) {
  let cached = contentLengthCache[length]
  if (cached === undefined) {
    cached = `Content-Length: ${length}\r\n`
    // Cache for next time if reasonable size and under the dynamic cap.
    if (length < 1_000_000 && dynamicEntryCount < MAX_DYNAMIC_ENTRIES) {
      contentLengthCache[length] = cached
      dynamicEntryCount++
    }
  }
  return cached
}

module.exports = {
  __proto__: null,
  getContentLength,
  getHeader,
  getStatusLine,
}
