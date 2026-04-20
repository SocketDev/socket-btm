'use strict'

// Documentation: docs/additions/lib/internal/socketsecurity/http/client.js.md

const {
  ArrayPrototypePush,
  Error: ErrorCtor,
  JSONParse,
  ObjectFreeze,
  PromisePrototypeThen,
  StringPrototypeStartsWith,
} = primordials

const {
  BufferConcat,
  BufferPrototypeToString,
} = require('internal/socketsecurity/safe-references')

const {
  DEFAULT_KEEP_ALIVE_MAX_TIMEOUT,
  DEFAULT_KEEP_ALIVE_TIMEOUT,
} = require('internal/socketsecurity/http/constants')

// Lazy module loading.
let _http, _https
function getHttp() {
  return _http || (_http = require('http'))
}
function getHttps() {
  return _https || (_https = require('https'))
}

// Shared agents with keep-alive for connection reuse.
let _httpAgent, _httpsAgent

function getHttpAgent() {
  if (!_httpAgent) {
    _httpAgent = new (getHttp().Agent)({
      keepAlive: true,
      maxSockets: 64,
      maxFreeSockets: 16,
      timeout: 30_000,
    })
  }
  return _httpAgent
}

function getHttpsAgent() {
  if (!_httpsAgent) {
    _httpsAgent = new (getHttps().Agent)({
      keepAlive: true,
      maxSockets: 64,
      maxFreeSockets: 16,
      timeout: 30_000,
    })
  }
  return _httpsAgent
}

// Default response body cap. A misbehaving server can stream unbounded
// bytes; without a cap the client buffers all of it in memory and OOMs.
// 100 MB is generous for normal use; callers can override via maxBodyBytes.
const DEFAULT_MAX_BODY_BYTES = 100 * 1024 * 1024

/**
 * Make an HTTP request. Returns a plain result with body already buffered.
 *
 * @param {string|URL} url The URL to request
 * @param {object} [options] Request options
 * @param {string} [options.method='GET'] HTTP method
 * @param {object} [options.headers] Request headers
 * @param {string|Buffer} [options.body] Request body
 * @param {number} [options.timeout=30_000] Request timeout in ms
 * @param {number} [options.maxBodyBytes=104857600] Reject responses larger than this
 * @param {AbortSignal} [options.signal] AbortSignal for cancellation
 * @returns {Promise<{status: number, headers: object, body: string|Buffer, json: function}>}
 */
function request(url, options) {
  const opts = options ? { __proto__: null, ...options } : { __proto__: null }
  const {
    method = 'GET',
    headers,
    body: reqBody,
    timeout = 30_000,
    maxBodyBytes = DEFAULT_MAX_BODY_BYTES,
    signal,
  } = opts

  const parsedUrl = typeof url === 'string' ? new URL(url) : url
  const isHttps = parsedUrl.protocol === 'https:'
  const httpMod = isHttps ? getHttps() : getHttp()
  const agent = isHttps ? getHttpsAgent() : getHttpAgent()

  return new Promise((resolve, reject) => {
    let settled = false
    const settle = (fn, value) => {
      if (settled) return
      settled = true
      fn(value)
    }

    const req = httpMod.request(
      parsedUrl,
      {
        method,
        headers,
        agent,
        timeout,
        signal,
      },
      res => {
        const chunks = []
        let received = 0
        res.on('data', chunk => {
          received += chunk.length
          if (received > maxBodyBytes) {
            res.destroy()
            req.destroy()
            settle(
              reject,
              new ErrorCtor(
                `Response body exceeds maxBodyBytes (${maxBodyBytes})`,
              ),
            )
            return
          }
          ArrayPrototypePush(chunks, chunk)
        })
        res.on('end', () => {
          if (settled) return
          const bodyBuf = BufferConcat(chunks)
          const contentType = res.headers['content-type'] || ''
          const isText =
            StringPrototypeStartsWith(contentType, 'text/') ||
            StringPrototypeStartsWith(contentType, 'application/json')
          const bodyStr = isText
            ? BufferPrototypeToString(bodyBuf, 'utf8')
            : undefined

          settle(
            resolve,
            ObjectFreeze({
              __proto__: null,
              status: res.statusCode,
              headers: res.headers,
              body: bodyStr !== undefined ? bodyStr : bodyBuf,
              json() {
                return JSONParse(
                  bodyStr !== undefined
                    ? bodyStr
                    : BufferPrototypeToString(bodyBuf, 'utf8'),
                )
              },
            }),
          )
        })
        res.on('error', err => settle(reject, err))
      },
    )

    req.on('error', err => settle(reject, err))
    req.on('timeout', () => {
      req.destroy(new ErrorCtor('Request timeout'))
    })

    if (reqBody) {
      req.write(reqBody)
    }
    req.end()
  })
}

/**
 * Configure pipelining for the HTTP client.
 *
 * Requires undici to be installed in the project's node_modules.
 * Without undici, pipelining is not available and this is a no-op.
 *
 * @param {number} depth Pipelining depth (1 = serial, N > 1 = pipelined)
 * @param {object} [options] Agent options
 * @param {number} [options.connections] Max connections per origin
 */
function setPipelining(depth, options) {
  // Try to load undici from user's node_modules.
  let undici
  try {
    undici = require('undici')
  } catch {
    // undici not available — pipelining not supported.
    // The request() function will continue using http.Agent.
    return
  }

  const { setGlobalDispatcher, Agent } = undici
  setGlobalDispatcher(
    new Agent({
      pipelining: depth,
      connections: options?.connections ?? null,
      keepAliveTimeout: DEFAULT_KEEP_ALIVE_TIMEOUT,
      keepAliveMaxTimeout: DEFAULT_KEEP_ALIVE_MAX_TIMEOUT,
    }),
  )
}

module.exports = {
  __proto__: null,
  request,
  setPipelining,
}
