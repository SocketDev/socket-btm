'use strict'

// HTTP/2 helpers for improved performance.
// Note: HTTP/2 server push was removed from Chrome in 2022.
// Instead, use Link preload headers and multiplexing.

const {
  ArrayPrototypeFilter,
  ArrayPrototypeJoin,
  ArrayPrototypeMap,
  JSONStringify,
  RegExpPrototypeTest,
  StringPrototypeEndsWith,
  hardenRegExp,
} = primordials

// Npm package name grammar — ASCII letters/digits plus a small, fixed set
// of punctuation. No whitespace, no CR/LF, no `;`/`,`/`>`/`<` that could
// break the Link header framing. Rejecting anything outside this set
// prevents response splitting via a malicious upstream packument that
// encodes dependency keys containing header terminators.
const NPM_PACKAGE_NAME_REGEX = hardenRegExp(/^(?:@[a-zA-Z0-9][a-zA-Z0-9._-]*\/)?[a-zA-Z0-9][a-zA-Z0-9._-]*$/)

const {
  Http2CreateSecureServer,
} = require('internal/socketsecurity/safe-references')

const {
  DEFAULT_HTTP2_INITIAL_WINDOW_SIZE,
  DEFAULT_HTTP2_MAX_CONCURRENT_STREAMS,
  DEFAULT_HTTP2_MAX_FRAME_SIZE,
  DEFAULT_HTTP2_MAX_HEADER_LIST_SIZE,
  DEFAULT_HTTP2_SESSION_TIMEOUT,
} = require('internal/socketsecurity/http/constants')

// Lazy debug — createDebug reads process.env.DEBUG which may not be available
// during early module loading (Node.js bootstrap order).
let _debug
function debug(...args) {
  if (!_debug) {
    const { createDebug } = require('internal/socketsecurity/smol/debug')
    _debug = createDebug('smol:http2')
  }
  return _debug(...args)
}

// Create HTTP/2 server with optimized settings.
function createHttp2Server(options) {
  const opts = { __proto__: null, ...options }
  const serverOptions = {
    __proto__: null,
    // Pass unknown options through first, then let the explicit defaults below
    // overwrite them. Reversed order would let `{maxFrameSize: undefined}` from
    // the caller clobber our secure defaults via `...opts`.
    ...opts,
    // Allow max concurrent streams (default is 100). `??` preserves explicit 0.
    maxConcurrentStreams:
      opts.maxConcurrentStreams ?? DEFAULT_HTTP2_MAX_CONCURRENT_STREAMS,

    // Increase initial window size for better throughput.
    initialWindowSize: opts.initialWindowSize ?? DEFAULT_HTTP2_INITIAL_WINDOW_SIZE,

    // Enable server push (even though browsers removed support).
    enablePush: opts.enablePush !== false,

    // Set max frame size.
    maxFrameSize: opts.maxFrameSize ?? DEFAULT_HTTP2_MAX_FRAME_SIZE,

    // Set max header list size.
    maxHeaderListSize:
      opts.maxHeaderListSize ?? DEFAULT_HTTP2_MAX_HEADER_LIST_SIZE,

    // Enable session timeout (0 = no timeout).
    sessionTimeout: opts.sessionTimeout ?? DEFAULT_HTTP2_SESSION_TIMEOUT,
  }

  return Http2CreateSecureServer(serverOptions)
}

// Send response with Link preload headers for dependencies.
function sendWithPreloads(stream, headers, data, dependencies = []) {
  // Add Link headers for preloading dependencies. Dependency names come
  // from untrusted upstream packument data — filter to strict npm name
  // grammar so CR/LF/`;`/`,`/`>` can't terminate the Link header early
  // (response splitting / fake-header injection).
  const safeDeps = ArrayPrototypeFilter(dependencies, dep =>
    typeof dep === 'string' && RegExpPrototypeTest(NPM_PACKAGE_NAME_REGEX, dep),
  )
  if (safeDeps.length > 0) {
    const linkHeader = ArrayPrototypeJoin(
      ArrayPrototypeMap(
        safeDeps,
        dep => `</${dep}>; rel=preload; as=fetch`,
      ),
      ', ',
    )

    headers['link'] = linkHeader
  }

  // Send response.
  stream.respond(headers)
  stream.end(data)
}

// Send packument with dependency preloads.
function sendPackumentWithDeps(stream, packument, dependencies) {
  const headers = {
    __proto__: null,
    ':status': 200,
    'content-type': 'application/json',
    'cache-control': 'public, max-age=3600',
  }

  sendWithPreloads(stream, headers, JSONStringify(packument), dependencies)
}

// Handle HTTP/2 session with optimizations.
function optimizeHttp2Session(session) {
  // Set priority for streams.
  session.on('stream', (stream, headers) => {
    // Prioritize packument requests over tarballs.
    const path = headers[':path']
    if (path && !StringPrototypeEndsWith(path, '.tgz')) {
      // Higher priority for metadata.
      stream.priority({
        __proto__: null,
        exclusive: false,
        parent: 0,
        weight: 16,
      })
    }
  })

  // Monitor session health.
  session.on('error', err => {
    debug('HTTP/2 session error:', err)
  })

  session.on('goaway', (errorCode, lastStreamID) => {
    debug('HTTP/2 GOAWAY:', { __proto__: null, errorCode, lastStreamID })
  })
}

// Get session statistics.
function getHttp2Stats(session) {
  const state = session.state
  return {
    __proto__: null,
    effectiveLocalWindowSize: state.effectiveLocalWindowSize,
    effectiveRecvDataLength: state.effectiveRecvDataLength,
    localSettings: session.localSettings,
    localWindowSize: state.localWindowSize,
    nextStreamID: state.nextStreamID,
    outboundQueueSize: state.outboundQueueSize,
    remoteSettings: session.remoteSettings,
    remoteWindowSize: state.remoteWindowSize,
  }
}

module.exports = {
  __proto__: null,
  createHttp2Server,
  getHttp2Stats,
  optimizeHttp2Session,
  sendPackumentWithDeps,
  sendWithPreloads,
}
