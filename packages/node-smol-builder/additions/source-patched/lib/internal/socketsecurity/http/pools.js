'use strict'

// HTTP Object Pools
// Reuse objects to avoid GC pressure on hot paths.
// Request/response objects are pooled in C++ (smol_http binding) for
// cross-boundary reuse and stable V8 hidden classes. JS-specific fields
// (query, params, _headerMap, etc.) are layered on at acquire time and
// cleaned up at release time before returning to the native pool.

const { ArrayPrototypePop, ArrayPrototypePush } = primordials

// Native HTTP binding — object pool methods (lazy).
let _smolHttpBinding
function smolHttp() {
  if (!_smolHttpBinding) _smolHttpBinding = internalBinding('smol_http')
  return _smolHttpBinding
}
function nativeAcquireRequest() {
  return smolHttp().acquireRequest()
}
function nativeReleaseRequest(req) {
  return smolHttp().releaseRequest(req)
}
function nativeAcquireResponse() {
  return smolHttp().acquireResponse()
}
function nativeReleaseResponse(res) {
  return smolHttp().releaseResponse(res)
}
function nativeGetObjectPoolStats() {
  return smolHttp().getObjectPoolStats()
}

// Use Node.js built-in llhttp parser (lazy).
let _httpParserBinding
function getHTTPParser() {
  if (!_httpParserBinding)
    _httpParserBinding = internalBinding('http_parser').HTTPParser
  return _httpParserBinding
}

// ============================================================================
// HTTPParser Pool
// ============================================================================

const PARSER_POOL_SIZE = 16
const parserPool = []

/**
 * Acquire an HTTPParser from the pool or create a new one.
 * @returns {HTTPParser}
 */
function acquireParser() {
  if (parserPool.length > 0) {
    return ArrayPrototypePop(parserPool)
  }
  return new (getHTTPParser())()
}

/**
 * Release an HTTPParser back to the pool.
 * @param {HTTPParser} parser
 */
function releaseParser(parser) {
  // Reset parser callbacks
  const HP = getHTTPParser()
  const kOnMessageBegin = HP.kOnMessageBegin | 0
  const kOnHeaders = HP.kOnHeaders | 0
  const kOnHeadersComplete = HP.kOnHeadersComplete | 0
  const kOnBody = HP.kOnBody | 0
  const kOnMessageComplete = HP.kOnMessageComplete | 0

  parser[kOnMessageBegin] = undefined
  parser[kOnHeaders] = undefined
  parser[kOnHeadersComplete] = undefined
  parser[kOnBody] = undefined
  parser[kOnMessageComplete] = undefined

  if (parserPool.length < PARSER_POOL_SIZE) {
    ArrayPrototypePush(parserPool, parser)
  }
}

// ============================================================================
// Request Object Pool (backed by C++ HttpObjectPool)
// ============================================================================

/**
 * Acquire a request object from the native pool or create a new one.
 * The C++ pool provides the base V8 object with stable hidden class;
 * JS-specific fields are layered on here.
 * @returns {object}
 */
function acquireRequest() {
  const req = nativeAcquireRequest()
  // Minimal property init — only what's needed for stable V8 hidden class.
  // The per-connection SafeMap (currentHeaders) is assigned to _headerMap
  // in prepareAndDispatch, avoiding a new SafeMap() allocation per request.
  req.method = ''
  req.pathname = ''
  req.query = { __proto__: null }
  req.params = { __proto__: null }
  req.body = ''
  return req
}

/**
 * Release a request object back to the native pool.
 * Clears JS-specific fields to prevent memory leaks, then delegates
 * to the C++ pool which stores the object as a v8::Global for reuse.
 * @param {object} req
 */
function releaseRequest(req) {
  // Reset fields to prevent memory leaks and prepare for reuse.
  req.method = ''
  req.pathname = ''
  req.body = ''
  req.query = { __proto__: null }
  req.params = { __proto__: null }
  req._socket = undefined
  req._ip = undefined
  req._url = undefined
  req._host = undefined
  req._rawUrl = undefined
  req._headerMap = undefined
  req.text = undefined
  req.json = undefined
  req.arrayBuffer = undefined

  // Return to native pool (C++ resets its own tracked properties)
  nativeReleaseRequest(req)
}

// ============================================================================
// Response Object Pool (backed by C++ HttpObjectPool)
// ============================================================================

/**
 * Acquire a response object from the native pool.
 * @returns {object}
 */
function acquireResponse() {
  return nativeAcquireResponse()
}

/**
 * Release a response object back to the native pool.
 * @param {object} res
 */
function releaseResponse(res) {
  nativeReleaseResponse(res)
}

// ============================================================================
// Pool Statistics
// ============================================================================

/**
 * Get native object pool statistics.
 * @returns {{ requestPoolSize: number, responsePoolSize: number }}
 */
function getObjectPoolStats() {
  return nativeGetObjectPoolStats()
}

module.exports = {
  __proto__: null,
  // Parser pool
  acquireParser,
  releaseParser,
  // Request pool (native-backed)
  acquireRequest,
  releaseRequest,
  // Response pool (native-backed)
  acquireResponse,
  releaseResponse,
  // Pool statistics
  getObjectPoolStats,
}
