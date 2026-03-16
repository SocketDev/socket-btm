'use strict';

const {
  writeJsonResponse: nativeWriteJson,
  writeBinaryResponse: nativeWriteBinary,
  writeNotModifiedResponse: nativeWriteNotModified,
} = internalBinding('socketsecurity_http_perf');

const {
  createCacheKey,
  stringifyWithCache,
} = require('internal/socketsecurity/http-perf/json-cache');

// Fast path: write complete JSON response using native code.
// Bypasses Node.js HTTP stack for 25-40% latency improvement.
// Optionally uses JSON cache if cacheKey provided.
function fastJsonResponse(response, statusCode, data, cacheKey) {
  const { socket } = response;
  if (!socket || socket.destroyed) {
    return false;
  }

  // Convert data to JSON with optional caching.
  const json = typeof data === 'string'
    ? data
    : stringifyWithCache(data, cacheKey);

  // Try native fast path.
  const success = nativeWriteJson(socket, statusCode, json);

  if (!success) {
    // Fallback to standard response.
    response.statusCode = statusCode;
    response.setHeader('Content-Type', 'application/json');
    response.setHeader('Content-Length', Buffer.byteLength(json));
    response.end(json);
  }

  return success;
}

// Fast path: write complete binary response using native code.
function fastBinaryResponse(response, statusCode, buffer, contentType) {
  const { socket } = response;
  if (!socket || socket.destroyed) {
    return false;
  }

  const type = contentType || 'application/octet-stream';

  // Try native fast path.
  const success = nativeWriteBinary(socket, statusCode, buffer, type);

  if (!success) {
    // Fallback to standard response.
    response.statusCode = statusCode;
    response.setHeader('Content-Type', type);
    response.setHeader('Content-Length', buffer.length);
    response.end(buffer);
  }

  return success;
}

// Fast path: write 304 Not Modified using native code.
function fastNotModified(response) {
  const { socket } = response;
  if (!socket || socket.destroyed) {
    return false;
  }

  // Try native fast path.
  const success = nativeWriteNotModified(socket);

  if (!success) {
    // Fallback to standard response.
    response.statusCode = 304;
    response.end();
  }

  return success;
}

// Convenience wrapper for packument responses (most common in registry).
// Automatically creates cache key from request URL.
function fastPackumentResponse(response, packument, request) {
  // Create cache key from request if provided.
  const cacheKey = request
    ? createCacheKey(request.method, request.url)
    : undefined;

  return fastJsonResponse(response, 200, packument, cacheKey);
}

// Convenience wrapper for tarball responses.
function fastTarballResponse(response, buffer) {
  return fastBinaryResponse(response, 200, buffer, 'application/octet-stream');
}

// Convenience wrapper for error responses.
function fastErrorResponse(response, statusCode, message) {
  const error = message
    ? { error: getErrorName(statusCode), message }
    : { error: getErrorName(statusCode) };
  return fastJsonResponse(response, statusCode, error);
}

// Get error name from status code.
function getErrorName(statusCode) {
  switch (statusCode) {
    case 400:
      return 'Bad Request';
    case 404:
      return 'Not Found';
    case 500:
      return 'Internal Server Error';
    default:
      return 'Error';
  }
}

module.exports = {
  fastBinaryResponse,
  fastErrorResponse,
  fastJsonResponse,
  fastNotModified,
  fastPackumentResponse,
  fastTarballResponse,
};
