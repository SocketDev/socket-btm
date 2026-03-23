'use strict';

// HTTP Object Pools
// Reuse objects to avoid GC pressure on hot paths.

const {
  ArrayPrototypePop,
  ArrayPrototypePush,
  SafeMap,
} = primordials;

const {
  BufferAlloc,
} = require('internal/socketsecurity/safe-references');

// Use Node.js built-in llhttp parser
const { HTTPParser } = internalBinding('http_parser');

// ============================================================================
// HTTPParser Pool
// ============================================================================

const PARSER_POOL_SIZE = 16;
const parserPool = [];

/**
 * Acquire an HTTPParser from the pool or create a new one.
 * @returns {HTTPParser}
 */
function acquireParser() {
  if (parserPool.length > 0) {
    return ArrayPrototypePop(parserPool);
  }
  return new HTTPParser();
}

/**
 * Release an HTTPParser back to the pool.
 * @param {HTTPParser} parser
 */
function releaseParser(parser) {
  // Reset parser callbacks
  const kOnMessageBegin = HTTPParser.kOnMessageBegin | 0;
  const kOnHeaders = HTTPParser.kOnHeaders | 0;
  const kOnHeadersComplete = HTTPParser.kOnHeadersComplete | 0;
  const kOnBody = HTTPParser.kOnBody | 0;
  const kOnMessageComplete = HTTPParser.kOnMessageComplete | 0;

  parser[kOnMessageBegin] = undefined;
  parser[kOnHeaders] = undefined;
  parser[kOnHeadersComplete] = undefined;
  parser[kOnBody] = undefined;
  parser[kOnMessageComplete] = undefined;

  if (parserPool.length < PARSER_POOL_SIZE) {
    ArrayPrototypePush(parserPool, parser);
  }
}

// ============================================================================
// Buffer Pool
// ============================================================================

const BUFFER_POOL_SIZE = 32;
const POOLED_BUFFER_SIZE = 4096;
const bufferPool = [];

/**
 * Acquire a buffer from the pool or create a new one.
 * @param {number} [minSize=POOLED_BUFFER_SIZE] Minimum buffer size
 * @returns {Buffer}
 */
function acquireBuffer(minSize = POOLED_BUFFER_SIZE) {
  if (minSize <= POOLED_BUFFER_SIZE && bufferPool.length > 0) {
    return ArrayPrototypePop(bufferPool);
  }
  return BufferAlloc(minSize);
}

/**
 * Release a buffer back to the pool.
 * @param {Buffer} buffer
 */
function releaseBuffer(buffer) {
  if (buffer.length === POOLED_BUFFER_SIZE && bufferPool.length < BUFFER_POOL_SIZE) {
    // Clear sensitive data before pooling
    buffer.fill(0);
    ArrayPrototypePush(bufferPool, buffer);
  }
}

// ============================================================================
// Request Object Pool
// ============================================================================

const REQUEST_POOL_SIZE = 64;
const requestPool = [];

/**
 * Acquire a request object from the pool or create a new one.
 * @returns {object}
 */
function acquireRequest() {
  if (requestPool.length > 0) {
    return ArrayPrototypePop(requestPool);
  }
  return {
    __proto__: null,
    method: '',
    url: '',
    pathname: '',
    query: { __proto__: null },
    params: { __proto__: null },
    headers: { __proto__: null },
    body: '',
    _headerMap: new SafeMap(),
  };
}

/**
 * Release a request object back to the pool.
 * NOTE: Uses object replacement instead of delete to avoid V8 deoptimization.
 * @param {object} req
 */
function releaseRequest(req) {
  if (requestPool.length >= REQUEST_POOL_SIZE) return;

  // Reset fields
  req.method = '';
  req.url = '';
  req.pathname = '';
  req.body = '';

  // Replace objects instead of using delete (avoids V8 deoptimization)
  req.query = { __proto__: null };
  req.params = { __proto__: null };

  // Clear socket and cached IP (prevents memory leaks)
  req._socket = undefined;
  req._ip = undefined;

  // Clear lazy URL fields (prevents memory leaks)
  req._url = undefined;
  req._host = undefined;
  req._rawUrl = undefined;

  // Clear header map (reuse the SafeMap)
  req._headerMap.clear();

  ArrayPrototypePush(requestPool, req);
}

module.exports = {
  __proto__: null,
  // Parser pool
  acquireParser,
  releaseParser,
  // Buffer pool
  acquireBuffer,
  releaseBuffer,
  POOLED_BUFFER_SIZE,
  // Request pool
  acquireRequest,
  releaseRequest,
};
