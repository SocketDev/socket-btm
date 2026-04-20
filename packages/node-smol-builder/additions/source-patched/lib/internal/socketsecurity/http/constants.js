'use strict'

// Documentation: docs/additions/lib/internal/socketsecurity/http/constants.js.md

const { ObjectFreeze, hardenRegExp } = primordials

const { BufferFrom } = require('internal/socketsecurity/safe-references')

// ============================================================================
// HTTP Status Text Lookup
// ============================================================================

const STATUS_TEXT = ObjectFreeze({
  __proto__: null,
  200: 'OK',
  201: 'Created',
  204: 'No Content',
  301: 'Moved Permanently',
  302: 'Found',
  304: 'Not Modified',
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
})

// ============================================================================
// WebSocket Constants
// ============================================================================

const WS_OPCODE_TEXT = 0x01
const WS_OPCODE_BINARY = 0x02
const WS_OPCODE_CLOSE = 0x08
const WS_OPCODE_PING = 0x09
const WS_OPCODE_PONG = 0x0a

// WebSocket GUID for handshake
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

// ============================================================================
// Hardened Regex Patterns (protected from prototype pollution)
// ============================================================================

const SLASH_REGEX = hardenRegExp(/\//)

// ============================================================================
// Pre-computed Response Buffers (zero allocation on hot path)
// ============================================================================

const HTTP_200_JSON = BufferFrom(
  'HTTP/1.1 200 OK\r\n' +
    'Content-Type: application/json\r\n' +
    'Connection: keep-alive\r\n' +
    'Content-Length: ',
)

const HTTP_200_TEXT = BufferFrom(
  'HTTP/1.1 200 OK\r\n' +
    'Content-Type: text/plain\r\n' +
    'Connection: keep-alive\r\n' +
    'Content-Length: ',
)

// Complete response for empty string - single write, zero allocation!
const HTTP_200_EMPTY = BufferFrom(
  'HTTP/1.1 200 OK\r\n' +
    'Content-Type: text/plain\r\n' +
    'Content-Length: 0\r\n' +
    'Connection: keep-alive\r\n\r\n',
)

const HTTP_404 = BufferFrom(
  'HTTP/1.1 404 Not Found\r\n' +
    'Content-Length: 0\r\n' +
    'Connection: keep-alive\r\n\r\n',
)

// Binary (octet-stream) response prefix
const HTTP_200_BINARY = BufferFrom(
  'HTTP/1.1 200 OK\r\n' +
    'Content-Type: application/octet-stream\r\n' +
    'Connection: keep-alive\r\n' +
    'Content-Length: ',
)

// 413 response with JSON body
const HTTP_413_BODY =
  '{"error":"Payload Too Large","message":"Request body exceeds maxBodySize limit"}'
const HTTP_413 = BufferFrom(
  'HTTP/1.1 413 Payload Too Large\r\n' +
    'Content-Type: application/json\r\n' +
    `Content-Length: ${HTTP_413_BODY.length}\r\n` +
    'Connection: close\r\n' +
    '\r\n' +
    HTTP_413_BODY,
)

const HTTP_500 = BufferFrom(
  'HTTP/1.1 500 Internal Server Error\r\n' +
    'Content-Length: 0\r\n' +
    'Connection: keep-alive\r\n\r\n',
)

const CRLF_BUF = BufferFrom('\r\n\r\n')

// ============================================================================
// Content-Length Cache (avoids string allocation for 99.9% of responses)
// ============================================================================

const CONTENT_LENGTH_CACHE_SIZE = 10_000
let _contentLengthCache
function getContentLengthCache() {
  if (!_contentLengthCache) {
    _contentLengthCache = new Array(CONTENT_LENGTH_CACHE_SIZE)
    for (let i = 0; i < CONTENT_LENGTH_CACHE_SIZE; i++) {
      _contentLengthCache[i] = BufferFrom(i + '\r\n\r\n')
    }
  }
  return _contentLengthCache
}

// ============================================================================
// Status Line Cache (avoids string concatenation for common status codes)
// Format: "HTTP/1.1 {status} {text}\r\nContent-Length: "
// ============================================================================

const STATUS_LINE_CACHE = ObjectFreeze({
  __proto__: null,
  200: BufferFrom('HTTP/1.1 200 OK\r\nContent-Length: '),
  201: BufferFrom('HTTP/1.1 201 Created\r\nContent-Length: '),
  204: BufferFrom('HTTP/1.1 204 No Content\r\nContent-Length: '),
  301: BufferFrom('HTTP/1.1 301 Moved Permanently\r\nContent-Length: '),
  302: BufferFrom('HTTP/1.1 302 Found\r\nContent-Length: '),
  304: BufferFrom('HTTP/1.1 304 Not Modified\r\nContent-Length: '),
  400: BufferFrom('HTTP/1.1 400 Bad Request\r\nContent-Length: '),
  401: BufferFrom('HTTP/1.1 401 Unauthorized\r\nContent-Length: '),
  403: BufferFrom('HTTP/1.1 403 Forbidden\r\nContent-Length: '),
  404: BufferFrom('HTTP/1.1 404 Not Found\r\nContent-Length: '),
  405: BufferFrom('HTTP/1.1 405 Method Not Allowed\r\nContent-Length: '),
  500: BufferFrom('HTTP/1.1 500 Internal Server Error\r\nContent-Length: '),
  502: BufferFrom('HTTP/1.1 502 Bad Gateway\r\nContent-Length: '),
  503: BufferFrom('HTTP/1.1 503 Service Unavailable\r\nContent-Length: '),
})

// Pre-computed "Connection: keep-alive\r\n" header
const KEEP_ALIVE_HEADER = BufferFrom('Connection: keep-alive\r\n')

// ============================================================================
// Pre-computed Content-Type Headers (for Response object fast paths)
// ============================================================================

// Common Content-Type + Connection combinations for Response objects
const CT_JSON_KEEPALIVE = BufferFrom(
  'Content-Type: application/json\r\nConnection: keep-alive\r\n\r\n',
)
const CT_TEXT_KEEPALIVE = BufferFrom(
  'Content-Type: text/plain\r\nConnection: keep-alive\r\n\r\n',
)
const CT_HTML_KEEPALIVE = BufferFrom(
  'Content-Type: text/html\r\nConnection: keep-alive\r\n\r\n',
)

// Content-Type lookup for fast header generation (lowercase keys)
const CONTENT_TYPE_HEADERS = ObjectFreeze({
  __proto__: null,
  'application/json': CT_JSON_KEEPALIVE,
  'text/plain': CT_TEXT_KEEPALIVE,
  'text/html': CT_HTML_KEEPALIVE,
})

// ============================================================================
// Common Header Names Cache (avoids toLowerCase allocations)
// ============================================================================

const COMMON_HEADER_NAMES = ObjectFreeze({
  __proto__: null,
  'Content-Type': 'content-type',
  'content-type': 'content-type',
  'Content-Length': 'content-length',
  'content-length': 'content-length',
  Host: 'host',
  host: 'host',
  'User-Agent': 'user-agent',
  'user-agent': 'user-agent',
  Accept: 'accept',
  accept: 'accept',
  Connection: 'connection',
  connection: 'connection',
  Upgrade: 'upgrade',
  upgrade: 'upgrade',
  'Sec-WebSocket-Key': 'sec-websocket-key',
  'sec-websocket-key': 'sec-websocket-key',
  'Sec-WebSocket-Version': 'sec-websocket-version',
  'sec-websocket-version': 'sec-websocket-version',
  Authorization: 'authorization',
  authorization: 'authorization',
  'Cache-Control': 'cache-control',
  'cache-control': 'cache-control',
  'Accept-Encoding': 'accept-encoding',
  'accept-encoding': 'accept-encoding',
})

// ============================================================================
// Default Limits for DoS Prevention
// ============================================================================

const DEFAULT_MAX_BODY_SIZE = 10 * 1024 * 1024 // 10MB
const DEFAULT_MAX_HEADER_SIZE = 16 * 1024 // 16KB

// Empty string constant to avoid allocations
const EMPTY_STRING = ''

// ============================================================================
// WebSocket Upgrade Response Templates (pre-computed for zero-allocation)
// ============================================================================

// Pre-computed prefix: "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: "
const WS_UPGRADE_PREFIX = BufferFrom(
  'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    'Sec-WebSocket-Accept: ',
)

// Pre-computed suffix: "\r\n\r\n"
const WS_UPGRADE_SUFFIX = BufferFrom('\r\n\r\n')

module.exports = {
  __proto__: null,
  // Status text
  STATUS_TEXT,
  // WebSocket
  WS_OPCODE_TEXT,
  WS_OPCODE_BINARY,
  WS_OPCODE_CLOSE,
  WS_OPCODE_PING,
  WS_OPCODE_PONG,
  WS_GUID,
  WS_UPGRADE_PREFIX,
  WS_UPGRADE_SUFFIX,
  // Regex
  SLASH_REGEX,
  // Pre-computed buffers
  HTTP_200_JSON,
  HTTP_200_TEXT,
  HTTP_200_EMPTY,
  HTTP_200_BINARY,
  HTTP_404,
  HTTP_413,
  HTTP_500,
  CRLF_BUF,
  // Content-length cache
  CONTENT_LENGTH_CACHE_SIZE,
  get CONTENT_LENGTH_CACHE() {
    return getContentLengthCache()
  },
  // Status line cache
  STATUS_LINE_CACHE,
  KEEP_ALIVE_HEADER,
  // Header names cache
  COMMON_HEADER_NAMES,
  // Pre-computed Content-Type headers
  CT_JSON_KEEPALIVE,
  CT_TEXT_KEEPALIVE,
  CT_HTML_KEEPALIVE,
  CONTENT_TYPE_HEADERS,
  // Limits
  DEFAULT_MAX_BODY_SIZE,
  DEFAULT_MAX_HEADER_SIZE,
  // Constants
  EMPTY_STRING,
}
