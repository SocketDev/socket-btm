'use strict';

// HTTP Server Implementation
// Bun.serve-compatible API with high-performance optimizations.

const {
  ArrayIsArray,
  ArrayPrototypeJoin,
  ArrayPrototypePush,
  JSONParse,
  JSONStringify,
  MapPrototypeGet,
  MapPrototypeSet,
  Number: NumberCtor,
  ObjectEntries,
  ObjectKeys,
  PromiseReject,
  PromiseResolve,
  SafeMap,
  SafeSet,
  SafeWeakMap,
  SetPrototypeAdd,
  SetPrototypeDelete,
  String: StringCtor,
  StringPrototypeCharCodeAt,
  StringPrototypeIndexOf,
  StringPrototypeSlice,
  StringPrototypeToLowerCase,
  decodeURIComponent: DecodeURIComponent,
} = primordials;

// Native HTTP performance binding - bypasses Node.js HTTP stack
let nativeWriteJson;
let nativeWriteText;
let nativeWriteBinary;
let isHeaders;

try {
  const smolHttpBinding = internalBinding('smol_http');
  // Native response writers (25-40% faster than JS)
  nativeWriteJson = smolHttpBinding.writeJsonResponse;
  nativeWriteText = smolHttpBinding.writeTextResponse;
  nativeWriteBinary = smolHttpBinding.writeBinaryResponse;
  // Native brand check for Headers (O(1) via V8 internal slots)
  if (typeof smolHttpBinding.isHeaders === 'function') {
    isHeaders = smolHttpBinding.isHeaders;
  }
} catch {
  // Binding not available
}

// Fallback: Fast duck-type check for Headers-like object
if (!isHeaders) {
  isHeaders = function isHeadersDuckType(obj) {
    return obj != null &&
      typeof obj.get === 'function' &&
      typeof obj.forEach === 'function';
  };
}

const {
  BufferFrom,
  BufferIsBuffer,
  CryptoCreateHash,
  InternalUtilTypesIsPromise,
} = require('internal/socketsecurity/safe-references');

// Buffer.concat captured for safe usage
const BufferConcat = Buffer.concat;

// Use Node.js built-in llhttp parser
const { HTTPParser, methods: HTTP_METHODS } = internalBinding('http_parser');

// HTTPParser callback constants
const kOnMessageBegin = HTTPParser.kOnMessageBegin | 0;
const kOnHeaders = HTTPParser.kOnHeaders | 0;
const kOnHeadersComplete = HTTPParser.kOnHeadersComplete | 0;
const kOnBody = HTTPParser.kOnBody | 0;
const kOnMessageComplete = HTTPParser.kOnMessageComplete | 0;

// eslint-disable-next-line n/prefer-node-protocol
const { createServer: createNetServer } = require('net');
// eslint-disable-next-line n/prefer-node-protocol
const { createServer: createTlsServer } = require('tls');
const process = require('process')


// Import from internal modules
const {
  STATUS_TEXT,
  WS_GUID,
  WS_UPGRADE_PREFIX,
  WS_UPGRADE_SUFFIX,
  HTTP_200_JSON,
  HTTP_200_TEXT,
  HTTP_200_EMPTY,
  HTTP_200_BINARY,
  HTTP_404,
  HTTP_413,
  HTTP_500,
  CRLF_BUF,
  CONTENT_LENGTH_CACHE_SIZE,
  CONTENT_LENGTH_CACHE,
  STATUS_LINE_CACHE,
  KEEP_ALIVE_HEADER,
  COMMON_HEADER_NAMES,
  CT_TEXT_KEEPALIVE,
  CONTENT_TYPE_HEADERS,
  DEFAULT_MAX_BODY_SIZE,
  EMPTY_STRING,
} = require('internal/socketsecurity/http/constants');

const {
  acquireParser,
  releaseParser,
  acquireRequest,
  releaseRequest,
} = require('internal/socketsecurity/http/pools');

const {
  createTrieNode,
  trieInsert,
  trieMatch,
  releaseParams,
  releaseResult,
} = require('internal/socketsecurity/http/router');

const {
  createWebSocketHandler,
} = require('internal/socketsecurity/http/websocket');

/**
 * Create a high-performance HTTP server with Bun.serve-compatible API.
 *
 * @param {object} options Server options
 * @param {number} [options.port=3000] Port to listen on (0 for random)
 * @param {string} [options.hostname='0.0.0.0'] Hostname to bind to
 * @param {string} [options.unix] Unix socket path (overrides port/hostname)
 * @param {function} options.fetch Request handler: (request, server) => Response
 * @param {object} [options.routes] Route handlers mapping patterns to handlers
 * @param {object} [options.websocket] WebSocket handlers
 * @param {number} [options.idleTimeout=10] Connection idle timeout in seconds
 * @param {number} [options.maxBodySize=10485760] Maximum request body size (10MB default)
 * @returns {object} Server instance with Bun-compatible properties
 */
function serve(options) {
  const opts = { __proto__: null, ...options };

  const {
    port: requestedPort = 3000,
    hostname = '0.0.0.0',
    unix: unixPath,
    fetch: fetchHandler,
    routes: routeHandlers,
    websocket: wsHandlersInput,
    idleTimeout = 10,
    maxBodySize = DEFAULT_MAX_BODY_SIZE,
    error: errorHandler,
    development: developmentMode,
    // TLS options
    tls: tlsOptions,
    key: tlsKey,
    cert: tlsCert,
    ca: tlsCa,
    passphrase: tlsPassphrase,
  } = opts;

  // Determine if TLS is enabled
  const hasTls = tlsOptions || tlsKey || tlsCert;
  const effectiveTlsOptions = hasTls
    ? {
        __proto__: null,
        ...(tlsOptions || {}),
        ...(tlsKey ? { key: tlsKey } : {}),
        ...(tlsCert ? { cert: tlsCert } : {}),
        ...(tlsCa ? { ca: tlsCa } : {}),
        ...(tlsPassphrase ? { passphrase: tlsPassphrase } : {}),
      }
    : undefined;

  if (typeof fetchHandler !== 'function') {
    throw new TypeError('options.fetch must be a function');
  }

  // Determine development mode
  // eslint-disable-next-line n/no-process-env
  const isDevelopment = developmentMode !== undefined
    ? developmentMode
    : process.env.NODE_ENV !== 'production';

  const wsHandlers = wsHandlersInput ? { __proto__: null, ...wsHandlersInput } : { __proto__: null };

  // Build trie-based router
  const routeTrie = createTrieNode();
  if (routeHandlers) {
    const entries = ObjectEntries(routeHandlers);
    for (let i = 0; i < entries.length; i++) {
      const [pattern, handler] = entries[i];
      trieInsert(routeTrie, pattern, handler);
    }
  }

  // Track state
  let pendingRequests = 0;
  let pendingWebSockets = 0;
  let actualPort = requestedPort;
  const activeSockets = new SafeSet();
  const wsTopics = new SafeMap();
  const pendingUpgrades = new SafeWeakMap();
  let currentFetchHandler = fetchHandler;

  // Server instance
  const serverInstance = {
    __proto__: null,
    _wsTopics: wsTopics,
    development: isDevelopment,

    get port() { return actualPort; },
    hostname,

    get url() {
      if (unixPath) {
        return new URL(`unix://${unixPath}`);
      }
      const protocol = hasTls ? 'https' : 'http';
      return new URL(`${protocol}://${hostname === '0.0.0.0' ? 'localhost' : hostname}:${actualPort}/`);
    },

    get pendingRequests() { return pendingRequests; },
    get pendingWebSockets() { return pendingWebSockets; },

    subscriberCount(topic) {
      const subs = MapPrototypeGet(wsTopics, topic);
      return subs ? subs.size : 0;
    },

    publish(topic, data, compress = false) {
      const subs = MapPrototypeGet(wsTopics, topic);
      if (!subs) return 0;
      let count = 0;
      for (const ws of subs) {
        if (ws.readyState === 1) {
          ws.send(data, compress);
          count++;
        }
      }
      return count;
    },

    requestIP(req) {
      let ip = req._ip;
      if (ip !== undefined) return ip;
      const socket = req._socket;
      if (socket) {
        ip = {
          __proto__: null,
          address: socket.remoteAddress || 'unix',
          port: socket.remotePort || 0,
          family: socket.remoteFamily || 'unix',
        };
        req._ip = ip;
        return ip;
      }
      return undefined;
    },

    upgrade(req, data) {
      const upgradeHeader = req.headers.get('upgrade');
      if (upgradeHeader !== 'websocket') return false;
      const wsKey = req.headers.get('sec-websocket-key');
      if (!wsKey) return false;
      pendingUpgrades.set(req, { __proto__: null, data });
      return true;
    },

    reload(newOptions) {
      const newOpts = { __proto__: null, ...newOptions };
      if (newOpts.fetch && typeof newOpts.fetch === 'function') {
        currentFetchHandler = newOpts.fetch;
      }
      if (newOpts.routes) {
        routeTrie.children.clear();
        routeTrie.paramChild = undefined;
        routeTrie.wildcardChild = undefined;
        routeTrie.handler = undefined;
        routeTrie.methods = undefined;
        const entries = ObjectEntries(newOpts.routes);
        for (let i = 0; i < entries.length; i++) {
          const [pattern, handler] = entries[i];
          trieInsert(routeTrie, pattern, handler);
        }
      }
      if (newOpts.websocket) {
        const newWsHandlers = { __proto__: null, ...newOpts.websocket };
        const keys = ObjectKeys(newWsHandlers);
        for (let i = 0; i < keys.length; i++) {
          const key = keys[i];
          wsHandlers[key] = newWsHandlers[key];
        }
      }
    },

    stop(closeActiveConnections = false) {
      return new Promise((resolve) => {
        if (closeActiveConnections) {
          for (const socket of activeSockets) {
            socket.destroy();
          }
        }
        netServer.close(resolve);
      });
    },
  };

  // Connection handler
  function handleConnection(socket) {
    socket.setNoDelay(true);
    SetPrototypeAdd(activeSockets, socket);

    if (idleTimeout > 0) {
      socket.setTimeout(idleTimeout * 1000);
    }

    socket.on('timeout', () => socket.destroy());
    socket.on('close', () => SetPrototypeDelete(activeSockets, socket));

    let isWebSocket = false;
    const parser = acquireParser();
    const currentHeaders = new SafeMap();
    let currentMethod = '';
    let currentUrl = '';
    let bodyChunks = [];
    let bodyTotalLength = 0;
    let expectedContentLength = 0;
    let currentBody = '';
    let currentRequest = null;
    const urlProtocolPrefix = hasTls ? 'https://' : 'http://';

    const urlAccessor = {
      __proto__: null,
      toString() {
        const req = currentRequest;
        if (req && req._url === undefined) {
          req._url = `${urlProtocolPrefix}${req._host}${req._rawUrl}`;
        }
        return req ? req._url : '';
      },
      valueOf() { return this.toString(); },
    };

    const headersAccessor = {
      __proto__: null,
      get(name) {
        const lowerName = COMMON_HEADER_NAMES[name] || StringPrototypeToLowerCase(name);
        return MapPrototypeGet(currentHeaders, lowerName);
      },
      has(name) {
        const lowerName = COMMON_HEADER_NAMES[name] || StringPrototypeToLowerCase(name);
        return currentHeaders.has(lowerName);
      },
      entries() { return currentHeaders.entries(); },
      keys() { return currentHeaders.keys(); },
      values() { return currentHeaders.values(); },
      forEach(cb) { currentHeaders.forEach(cb); },
    };

    function textFn() { return PromiseResolve(currentBody); }
    function jsonFn() {
      try {
        return PromiseResolve(JSONParse(currentBody));
      } catch (err) {
        return PromiseReject(new TypeError(`Failed to parse request body as JSON: ${err.message}`));
      }
    }
    function arrayBufferFn() { return PromiseResolve(BufferFrom(currentBody).buffer); }

    parser.initialize(HTTPParser.REQUEST, {});

    parser[kOnMessageBegin] = function onMessageBegin() {
      currentHeaders.clear();
      currentMethod = '';
      currentUrl = '';
      // Reuse array instead of allocating new one (avoids GC pressure)
      bodyChunks.length = 0;
      bodyTotalLength = 0;
      expectedContentLength = 0;
    };

    parser[kOnHeadersComplete] = function onHeadersComplete(
      versionMajor, versionMinor, headers, method, url
    ) {
      currentMethod = HTTP_METHODS[method] || 'GET';
      currentUrl = url;

      if (ArrayIsArray(headers)) {
        for (let i = 0; i < headers.length; i += 2) {
          const name = StringPrototypeToLowerCase(headers[i]);
          const value = headers[i + 1];
          MapPrototypeSet(currentHeaders, name, value);
        }
      }

      const contentLengthStr = MapPrototypeGet(currentHeaders, 'content-length');
      if (contentLengthStr) {
        expectedContentLength = NumberCtor(contentLengthStr) || 0;
        if (expectedContentLength > maxBodySize) {
          socket.write(HTTP_413);
          socket.destroy();
          return 1;
        }
      }
      return 0;
    };

    parser[kOnBody] = function onBody(chunk, offset, length) {
      const bodyPart = chunk.slice(offset, offset + length);
      ArrayPrototypePush(bodyChunks, bodyPart);
      bodyTotalLength += length;
      if (bodyTotalLength > maxBodySize) {
        socket.write(HTTP_413);
        socket.destroy();
        return 1;
      }
      return 0;
    };

    parser[kOnMessageComplete] = function onMessageComplete() {
      handleRequest();
    };

    async function handleRequest() {
      pendingRequests++;
      try {
        currentBody = bodyChunks.length === 0
          ? EMPTY_STRING
          : bodyChunks.length === 1
            ? bodyChunks[0].toString('utf8')
            : BufferConcat(bodyChunks, bodyTotalLength).toString('utf8');

        let pathname;
        let queryString;
        const questionIdx = StringPrototypeIndexOf(currentUrl, '?');
        const host = MapPrototypeGet(currentHeaders, 'host') || 'localhost';

        if (questionIdx === -1) {
          pathname = currentUrl;
          queryString = undefined;
        } else {
          pathname = StringPrototypeSlice(currentUrl, 0, questionIdx);
          queryString = StringPrototypeSlice(currentUrl, questionIdx + 1);
        }

        const request = acquireRequest();
        currentRequest = request;
        request.method = currentMethod;
        request._host = host;
        request._rawUrl = currentUrl;
        request._url = undefined;
        request.url = urlAccessor;
        request.pathname = pathname;
        request.body = currentBody;
        request._headerMap = currentHeaders;
        request.headers = headersAccessor;
        request.text = textFn;
        request.json = jsonFn;
        request.arrayBuffer = arrayBufferFn;

        if (queryString !== undefined) {
          let start = 0;
          const qsLen = queryString.length;
          for (let i = 0; i <= qsLen; i++) {
            if (i === qsLen || StringPrototypeCharCodeAt(queryString, i) === 38) {
              if (i > start) {
                const eqIdx = StringPrototypeIndexOf(queryString, '=', start);
                if (eqIdx !== -1 && eqIdx < i) {
                  const key = DecodeURIComponent(StringPrototypeSlice(queryString, start, eqIdx));
                  const value = DecodeURIComponent(StringPrototypeSlice(queryString, eqIdx + 1, i));
                  request.query[key] = value;
                } else if (eqIdx === -1) {
                  const key = DecodeURIComponent(StringPrototypeSlice(queryString, start, i));
                  request.query[key] = EMPTY_STRING;
                }
              }
              start = i + 1;
            }
          }
        }

        request._socket = socket;

        let response;
        const routeMatch = trieMatch(routeTrie, request.pathname, request.method);
        if (routeMatch) {
          const matchParams = routeMatch.params;
          const handler = routeMatch.handler;
          // Copy params then immediately release pooled objects
          for (const key in matchParams) {
            const val = matchParams[key];
            if (val !== undefined) {
              request.params[key] = val;
            }
          }
          // Release pooled objects back to pool ASAP
          releaseParams(matchParams);
          releaseResult(routeMatch);
          response = handler(request, serverInstance);
          if (InternalUtilTypesIsPromise(response)) {
            response = await response;
          }
        }

        if (response === undefined) {
          response = currentFetchHandler(request, serverInstance);
          if (InternalUtilTypesIsPromise(response)) {
            response = await response;
          }
        }

        // WebSocket upgrade
        const upgradeInfo = pendingUpgrades.get(request);
        const upgradeHeader = MapPrototypeGet(currentHeaders, 'upgrade');
        if (upgradeInfo !== undefined || upgradeHeader === 'websocket') {
          const wsKey = MapPrototypeGet(currentHeaders, 'sec-websocket-key');
          if (!wsKey) {
            socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
            releaseRequest(request);
            return;
          }

          const hash = CryptoCreateHash('sha1');
          hash.update(wsKey + WS_GUID);
          const acceptKey = hash.digest('base64');

          // Use pre-computed buffers with cork for optimal TCP batching
          socket.cork();
          socket.write(WS_UPGRADE_PREFIX);
          socket.write(acceptKey);
          socket.write(WS_UPGRADE_SUFFIX);
          socket.uncork();

          isWebSocket = true;
          pendingWebSockets++;
          releaseParser(parser);

          const ws = createWebSocketHandler(socket, wsHandlers, serverInstance);
          if (upgradeInfo && upgradeInfo.data !== undefined) {
            ws.data = upgradeInfo.data;
          }

          socket.on('close', () => pendingWebSockets--);
          releaseRequest(request);
          return;
        }

        // Handle response
        if (response && typeof response.text === 'function') {
          const responseBody = await response.text();
          const status = response.status || 200;
          const bodyBuf = BufferFrom(responseBody);
          const bodyLen = bodyBuf.length;

          socket.cork();

          // Fast path: use cached status line if available (covers 99% of responses)
          const cachedStatusLine = STATUS_LINE_CACHE[status];
          if (cachedStatusLine && !response.headers) {
            // Super fast path: no custom headers, default to text/plain
            socket.write(cachedStatusLine);
            if (bodyLen < CONTENT_LENGTH_CACHE_SIZE) {
              socket.write(CONTENT_LENGTH_CACHE[bodyLen]);
            } else {
              socket.write(StringCtor(bodyLen));
              socket.write('\r\n');
            }
            socket.write(CT_TEXT_KEEPALIVE);
          } else if (cachedStatusLine) {
            // Fast path: cached status line with custom headers
            socket.write(cachedStatusLine);
            if (bodyLen < CONTENT_LENGTH_CACHE_SIZE) {
              socket.write(CONTENT_LENGTH_CACHE[bodyLen]);
            } else {
              socket.write(StringCtor(bodyLen));
              socket.write('\r\n');
            }
            // Check for pre-computed Content-Type header
            const headers = response.headers;
            const headersOk = isHeaders(headers);
            const contentType = headersOk ? headers.get('content-type') : undefined;
            const cachedCtHeader = contentType && CONTENT_TYPE_HEADERS[contentType];
            if (cachedCtHeader) {
              // Use pre-computed Content-Type + Connection header combo
              socket.write(cachedCtHeader);
            } else {
              socket.write(KEEP_ALIVE_HEADER);
              if (headersOk) {
                headers.forEach((value, name) => {
                  const lowerName = COMMON_HEADER_NAMES[name] || StringPrototypeToLowerCase(name);
                  if (lowerName !== 'content-length' && lowerName !== 'connection') {
                    socket.write(`${name}: ${value}\r\n`);
                  }
                });
              }
              socket.write('\r\n');
            }
          } else {
            // Slow path: uncommon status code
            const statusText = response.statusText || STATUS_TEXT[status] || EMPTY_STRING;
            socket.write(`HTTP/1.1 ${status} ${statusText}\r\nContent-Length: ${bodyLen}\r\n`);
            socket.write(KEEP_ALIVE_HEADER);
            const headers = response.headers;
            if (isHeaders(headers)) {
              headers.forEach((value, name) => {
                const lowerName = COMMON_HEADER_NAMES[name] || StringPrototypeToLowerCase(name);
                if (lowerName !== 'content-length' && lowerName !== 'connection') {
                  socket.write(`${name}: ${value}\r\n`);
                }
              });
            }
            socket.write('\r\n');
          }
          socket.write(bodyBuf);
          socket.uncork();
        } else if (response && typeof response === 'object' && !BufferIsBuffer(response)) {
          const jsonBody = JSONStringify(response);
          // Try native fast path first (25-40% faster)
          if (!nativeWriteJson || !nativeWriteJson(socket, 200, jsonBody)) {
            // Fallback to JS implementation
            const bodyLen = Buffer.byteLength(jsonBody);
            socket.cork();
            socket.write(HTTP_200_JSON);
            if (bodyLen < CONTENT_LENGTH_CACHE_SIZE) {
              socket.write(CONTENT_LENGTH_CACHE[bodyLen]);
            } else {
              socket.write(StringCtor(bodyLen));
              socket.write(CRLF_BUF);
            }
            socket.write(jsonBody);
            socket.uncork();
          }
        } else if (typeof response === 'string') {
          if (response.length === 0) {
            socket.write(HTTP_200_EMPTY);
          } else if (nativeWriteText && nativeWriteText(socket, 200, response)) {
            // Native fast path succeeded
          } else {
            // Fallback to JS implementation
            const bodyLen = Buffer.byteLength(response);
            if (bodyLen < CONTENT_LENGTH_CACHE_SIZE) {
              socket.cork();
              socket.write(HTTP_200_TEXT);
              socket.write(CONTENT_LENGTH_CACHE[bodyLen]);
              socket.write(response);
              socket.uncork();
            } else {
              const bodyBuf = BufferFrom(response);
              socket.cork();
              socket.write(HTTP_200_TEXT);
              socket.write(StringCtor(bodyBuf.length));
              socket.write(CRLF_BUF);
              socket.write(bodyBuf);
              socket.uncork();
            }
          }
        } else if (BufferIsBuffer(response)) {
          // Binary buffer response - try native fast path
          if (nativeWriteBinary && nativeWriteBinary(socket, 200, response, 'application/octet-stream')) {
            // Native fast path succeeded
          } else {
            // Fallback to JS implementation
            const bodyLen = response.length;
            socket.cork();
            socket.write(HTTP_200_BINARY);
            if (bodyLen < CONTENT_LENGTH_CACHE_SIZE) {
              socket.write(CONTENT_LENGTH_CACHE[bodyLen]);
            } else {
              socket.write(StringCtor(bodyLen));
              socket.write(CRLF_BUF);
            }
            socket.write(response);
            socket.uncork();
          }
        } else if (response === undefined) {
          socket.write(HTTP_404);
        } else {
          socket.write(HTTP_500);
        }

        releaseRequest(request);
      } catch (error) {
        if (isDevelopment) {
          // eslint-disable-next-line no-console
          console.error('Unhandled error in fetch handler:', error);
        }

        let errorResponse;
        if (errorHandler) {
          try {
            errorResponse = errorHandler(error);
          } catch {
            // Ignore errors in error handler
          }
        }

        if (errorResponse && typeof errorResponse.text === 'function') {
          try {
            const responseBody = await errorResponse.text();
            const status = errorResponse.status || 500;
            const bodyBuf = BufferFrom(responseBody);
            const bodyLen = bodyBuf.length;
            const headers = errorResponse.headers;
            const headersOk = isHeaders(headers);

            socket.cork();

            // Fast path: use cached status line if available
            const cachedStatusLine = STATUS_LINE_CACHE[status];
            if (cachedStatusLine) {
              socket.write(cachedStatusLine);
              if (bodyLen < CONTENT_LENGTH_CACHE_SIZE) {
                socket.write(CONTENT_LENGTH_CACHE[bodyLen]);
              } else {
                socket.write(StringCtor(bodyLen));
                socket.write('\r\n');
              }
              // Check for pre-computed Content-Type header (duck-type Headers check)
              const contentType = headersOk ? headers.get('content-type') : undefined;
              const cachedCtHeader = contentType && CONTENT_TYPE_HEADERS[contentType];
              if (cachedCtHeader) {
                socket.write(cachedCtHeader);
              } else {
                socket.write(KEEP_ALIVE_HEADER);
                if (headersOk) {
                  headers.forEach((value, name) => {
                    const lowerName = COMMON_HEADER_NAMES[name] || StringPrototypeToLowerCase(name);
                    if (lowerName !== 'content-length' && lowerName !== 'connection') {
                      socket.write(`${name}: ${value}\r\n`);
                    }
                  });
                }
                socket.write('\r\n');
              }
            } else {
              const statusText = errorResponse.statusText || STATUS_TEXT[status] || EMPTY_STRING;
              socket.write(`HTTP/1.1 ${status} ${statusText}\r\nContent-Length: ${bodyLen}\r\n`);
              socket.write(KEEP_ALIVE_HEADER);
              if (headersOk) {
                headers.forEach((value, name) => {
                  const lowerName = COMMON_HEADER_NAMES[name] || StringPrototypeToLowerCase(name);
                  if (lowerName !== 'content-length' && lowerName !== 'connection') {
                    socket.write(`${name}: ${value}\r\n`);
                  }
                });
              }
              socket.write('\r\n');
            }
            socket.write(bodyBuf);
            socket.uncork();
          } catch {
            socket.write(HTTP_500);
          }
        } else {
          socket.write(HTTP_500);
        }
      } finally {
        if (!isWebSocket) {
          pendingRequests--;
        }
      }
    }

    socket.on('data', (data) => {
      if (isWebSocket) return;
      const ret = parser.execute(data);
      if (ret instanceof Error) {
        socket.write(HTTP_500);
        socket.destroy();
      }
    });

    socket.on('close', () => {
      if (!isWebSocket) {
        releaseParser(parser);
      }
    });

    socket.on('error', () => {});
  }

  // Create server (TLS or plain TCP)
  const netServer = hasTls
    ? createTlsServer(effectiveTlsOptions, handleConnection)
    : createNetServer(handleConnection);

  // Listen
  if (unixPath) {
    netServer.listen(unixPath, () => {
      actualPort = 0;
    });
  } else {
    netServer.listen(requestedPort, hostname, () => {
      const addr = netServer.address();
      if (addr && typeof addr === 'object') {
        actualPort = addr.port;
      }
    });
  }

  return serverInstance;
}

module.exports = {
  __proto__: null,
  serve,
};
