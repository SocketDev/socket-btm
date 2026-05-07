'use strict'

const { JSONStringify } = primordials

const { BufferByteLength } = require('internal/socketsecurity/safe-references')

const { withCork } = require('internal/socketsecurity/http/cork_manager')

// Response writer for common registry patterns.
//
// NOTE: earlier versions had a "zero-allocation fast path" that wrote
// pre-formatted headers directly to `response.socket.write()` and
// never called `response.end()`. That broke Node's OutgoingMessage
// state machine — `_header`, `finished`, `writableEnded`, and the
// 'finish' event never fired, so keep-alive sockets desynced (Node
// thought nothing was sent) and `Connection:` / `Keep-Alive:` were
// never emitted, breaking HTTP/1.1 pipelining semantics. Always route
// through response.end() so the framework handles keep-alive, header
// completion, and lifecycle events correctly.

// Write JSON response.
function writeJsonResponse(response, statusCode, data) {
  const json = typeof data === 'string' ? data : JSONStringify(data)
  const length = BufferByteLength(json)

  return withCork(response, () => {
    response.statusCode = statusCode
    response.setHeader('Content-Type', 'application/json')
    response.setHeader('Content-Length', length)
    response.end(json)
  })
}

// Write tarball response (binary data).
function writeTarballResponse(response, statusCode, buffer) {
  return withCork(response, () => {
    response.statusCode = statusCode
    response.setHeader('Content-Type', 'application/octet-stream')
    response.setHeader('Content-Length', buffer.length)
    response.end(buffer)
  })
}

// Write 304 Not Modified (no body).
function writeNotModified(response) {
  return withCork(response, () => {
    response.statusCode = 304
    response.end()
  })
}

// Fast path: 404 Not Found with minimal JSON error.
function writeNotFound(response, message) {
  const json = message
    ? JSONStringify({ __proto__: null, error: 'Not Found', message })
    : '{"error":"Not Found"}'
  return writeJsonResponse(response, 404, json)
}

module.exports = {
  __proto__: null,
  writeJsonResponse,
  writeNotFound,
  writeNotModified,
  writeTarballResponse,
}
