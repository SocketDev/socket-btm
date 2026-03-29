'use strict';

const { JSONStringify } = primordials;

const {
  getContentLength,
  getHeader,
  getStatusLine,
} = require('internal/socketsecurity/http/header_cache');

const { withCork } = require('internal/socketsecurity/http/cork_manager');

// Optimized response writer for common registry patterns.
// Reduces allocations and syscalls for hot paths.

// Fast path: write JSON response with minimal overhead.
function writeJsonResponse(response, statusCode, data) {
  const json = typeof data === 'string' ? data : JSONStringify(data);
  const length = Buffer.byteLength(json);

  return withCork(response, () => {
    // Use pre-formatted headers where possible.
    const statusLine = getStatusLine(statusCode);
    const contentType = getHeader('Content-Type', 'application/json');
    const contentLength = getContentLength(length);

    // Build response with minimal allocations.
    if (statusLine && contentType && contentLength) {
      // All headers cached - zero allocation path.
      response.socket.write(statusLine, 'latin1');
      response.socket.write(contentType, 'latin1');
      response.socket.write(contentLength, 'latin1');
      response.socket.write('\r\n', 'latin1');
      response.socket.write(json, 'utf8');
      return true;
    }

    // Fallback to standard Node.js response.
    response.statusCode = statusCode;
    response.setHeader('Content-Type', 'application/json');
    response.setHeader('Content-Length', length);
    response.end(json);
    return false;
  });
}

// Fast path: write tarball response (binary data).
function writeTarballResponse(response, statusCode, buffer) {
  const length = buffer.length;

  return withCork(response, () => {
    const statusLine = getStatusLine(statusCode);
    const contentType = getHeader('Content-Type', 'application/octet-stream');
    const contentLength = getContentLength(length);

    if (statusLine && contentType && contentLength) {
      // All headers cached - zero allocation path.
      response.socket.write(statusLine, 'latin1');
      response.socket.write(contentType, 'latin1');
      response.socket.write(contentLength, 'latin1');
      response.socket.write('\r\n', 'latin1');
      response.socket.write(buffer);
      return true;
    }

    // Fallback.
    response.statusCode = statusCode;
    response.setHeader('Content-Type', 'application/octet-stream');
    response.setHeader('Content-Length', length);
    response.end(buffer);
    return false;
  });
}

// Fast path: 304 Not Modified (no body).
function writeNotModified(response) {
  return withCork(response, () => {
    const statusLine = getStatusLine(304);

    if (statusLine) {
      response.socket.write(statusLine, 'latin1');
      response.socket.write('\r\n', 'latin1');
      return true;
    }

    // Fallback.
    response.statusCode = 304;
    response.end();
    return false;
  });
}

// Fast path: 404 Not Found with minimal JSON error.
function writeNotFound(response, message) {
  const json = message
    ? JSON.stringify({ error: 'Not Found', message })
    : '{"error":"Not Found"}';
  return writeJsonResponse(response, 404, json);
}

module.exports = {
  __proto__: null,
  writeJsonResponse,
  writeNotFound,
  writeNotModified,
  writeTarballResponse,
};
