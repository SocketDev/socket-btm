'use strict';

// node:smol-http client — lean HTTP client with connection reuse.
//
// Uses Node.js built-in http/https modules for maximum compatibility.
// For pipelining, users should install undici and use setPipelining().
//
// Usage:
//   import { request } from 'node:smol-http';
//
//   const res = await request('https://registry.npmjs.org/lodash');
//   console.log(res.status, res.body);

const {
  ArrayPrototypePush,
  Error: ErrorCtor,
  JSONParse,
  ObjectFreeze,
  PromisePrototypeThen,
  StringPrototypeStartsWith,
} = primordials;

// Lazy module loading.
let _http, _https;
function getHttp() { return _http || (_http = require('http')); }
function getHttps() { return _https || (_https = require('https')); }

// Shared agents with keep-alive for connection reuse.
let _httpAgent, _httpsAgent;

function getHttpAgent() {
  if (!_httpAgent) {
    _httpAgent = new (getHttp().Agent)({
      keepAlive: true,
      maxSockets: 64,
      maxFreeSockets: 16,
      timeout: 30000,
    });
  }
  return _httpAgent;
}

function getHttpsAgent() {
  if (!_httpsAgent) {
    _httpsAgent = new (getHttps().Agent)({
      keepAlive: true,
      maxSockets: 64,
      maxFreeSockets: 16,
      timeout: 30000,
    });
  }
  return _httpsAgent;
}

/**
 * Make an HTTP request. Returns a plain result with body already buffered.
 *
 * @param {string|URL} url The URL to request
 * @param {object} [options] Request options
 * @param {string} [options.method='GET'] HTTP method
 * @param {object} [options.headers] Request headers
 * @param {string|Buffer} [options.body] Request body
 * @param {number} [options.timeout=30000] Request timeout in ms
 * @param {AbortSignal} [options.signal] AbortSignal for cancellation
 * @returns {Promise<{status: number, headers: object, body: string|Buffer, json: function}>}
 */
function request(url, options) {
  const opts = options ? { __proto__: null, ...options } : { __proto__: null };
  const {
    method = 'GET',
    headers,
    body: reqBody,
    timeout = 30000,
    signal,
  } = opts;

  const parsedUrl = typeof url === 'string' ? new URL(url) : url;
  const isHttps = parsedUrl.protocol === 'https:';
  const httpMod = isHttps ? getHttps() : getHttp();
  const agent = isHttps ? getHttpsAgent() : getHttpAgent();

  return new Promise((resolve, reject) => {
    const req = httpMod.request(parsedUrl, {
      method,
      headers,
      agent,
      timeout,
      signal,
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => ArrayPrototypePush(chunks, chunk));
      res.on('end', () => {
        const bodyBuf = Buffer.concat(chunks);
        const contentType = res.headers['content-type'] || '';
        const isText = StringPrototypeStartsWith(contentType, 'text/') ||
                       StringPrototypeStartsWith(contentType, 'application/json');
        const bodyStr = isText ? bodyBuf.toString('utf8') : undefined;

        resolve(ObjectFreeze({
          __proto__: null,
          status: res.statusCode,
          headers: res.headers,
          body: bodyStr !== undefined ? bodyStr : bodyBuf,
          json() {
            return JSONParse(bodyStr !== undefined ? bodyStr : bodyBuf.toString('utf8'));
          },
        }));
      });
      res.on('error', reject);
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new ErrorCtor('Request timeout'));
    });

    if (reqBody) {
      req.write(reqBody);
    }
    req.end();
  });
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
  let undici;
  try {
    undici = require('undici');
  } catch {
    // undici not available — pipelining not supported.
    // The request() function will continue using http.Agent.
    return;
  }

  const { setGlobalDispatcher, Agent } = undici;
  setGlobalDispatcher(new Agent({
    pipelining: depth,
    connections: options?.connections || null,
    keepAliveTimeout: 10000,
    keepAliveMaxTimeout: 600000,
  }));
}

module.exports = {
  __proto__: null,
  request,
  setPipelining,
};
