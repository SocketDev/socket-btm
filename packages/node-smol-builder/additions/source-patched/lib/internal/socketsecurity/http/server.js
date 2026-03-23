'use strict';

// HTTP Server Implementation
// Bun.serve-compatible API with high-performance optimizations.

const {
  ArrayIsArray,
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
  StringPrototypeIndexOf,
  StringPrototypeSlice,
  StringPrototypeToLowerCase,
} = primordials;

// Native HTTP binding (lazy).
let _smolHttpBinding;
function smolHttp() {
  if (!_smolHttpBinding) _smolHttpBinding = internalBinding('smol_http');
  return _smolHttpBinding;
}
function nativeWriteJson(...args) { return smolHttp().writeJsonResponse(...args); }
function nativeWriteText(...args) { return smolHttp().writeTextResponse(...args); }
function nativeWriteBinary(...args) { return smolHttp().writeBinaryResponse(...args); }
function isHeaders(...args) { return smolHttp().isHeaders(...args); }
function nativeCreateRouter(...args) { return smolHttp().createRouter(...args); }
function nativeAddRoute(...args) { return smolHttp().addRoute(...args); }
function nativeMatchRoute(...args) { return smolHttp().matchRoute(...args); }
function nativeParseUrl(...args) { return smolHttp().parseUrl(...args); }
function nativeParseQueryString(...args) { return smolHttp().parseQueryString(...args); }

const {
  BufferFrom,
  BufferIsBuffer,
  CryptoCreateHash,
  InternalUtilTypesIsPromise,
} = require('internal/socketsecurity/safe-references');

// Buffer.concat and allocUnsafe captured for safe usage
const BufferConcat = Buffer.concat;
const BufferAllocUnsafe = Buffer.allocUnsafe;

// Threshold for single-buffer response assembly (16KB)
const SINGLE_BUF_THRESHOLD = 16384;

// Use Node.js built-in llhttp parser (lazy).
let _httpParserBinding;
function httpParserBinding() {
  if (!_httpParserBinding) _httpParserBinding = internalBinding('http_parser');
  return _httpParserBinding;
}
function getHTTPParser() { return httpParserBinding().HTTPParser; }
function getHTTPMethods() { return httpParserBinding().methods; }

// HTTPParser callback constants (lazily resolved)
let _kOnMessageBegin, _kOnHeaders, _kOnHeadersComplete, _kOnBody, _kOnMessageComplete, _parserConstantsResolved;
function resolveParserConstants() {
  if (!_parserConstantsResolved) {
    const HTTPParser = getHTTPParser();
    _kOnMessageBegin = HTTPParser.kOnMessageBegin | 0;
    _kOnHeaders = HTTPParser.kOnHeaders | 0;
    _kOnHeadersComplete = HTTPParser.kOnHeadersComplete | 0;
    _kOnBody = HTTPParser.kOnBody | 0;
    _kOnMessageComplete = HTTPParser.kOnMessageComplete | 0;
    _parserConstantsResolved = true;
  }
}

const {
  NetCreateServer: createNetServer,
  TlsCreateServer: createTlsServer,
} = require('internal/socketsecurity/safe-references');


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

// JS trie router replaced by native C++ trie (smolHttp().createRouter/
// addRoute/matchRoute). The native router uses integer handler IDs; the
// handlerMap below maps IDs back to JS handler functions.

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
    // Network options (Bun-compatible)
    ipv6Only = false,
    reusePort = false,
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

  // Build native C++ trie router.
  // The C++ router uses integer handler IDs — handlerMap maps ID -> handler.
  nativeCreateRouter();
  let nextHandlerId = 0;
  const handlerMap = { __proto__: null };
  if (routeHandlers) {
    const entries = ObjectEntries(routeHandlers);
    for (let i = 0; i < entries.length; i++) {
      const [pattern, handler] = entries[i];
      const id = nextHandlerId++;
      handlerMap[id] = handler;
      nativeAddRoute(pattern, id);
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
    ipv6Only,
    reusePort,

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
        // Re-create the native router (clears all routes)
        nativeCreateRouter();
        nextHandlerId = 0;
        const hkeys = ObjectKeys(handlerMap);
        for (let hi = 0; hi < hkeys.length; hi++) {
          handlerMap[hkeys[hi]] = undefined;
        }
        const entries = ObjectEntries(newOpts.routes);
        for (let i = 0; i < entries.length; i++) {
          const [pattern, handler] = entries[i];
          const id = nextHandlerId++;
          handlerMap[id] = handler;
          nativeAddRoute(pattern, id);
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
    let currentRequest;
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

    const HTTPParser = getHTTPParser();
    resolveParserConstants();
    parser.initialize(HTTPParser.REQUEST, {});

    parser[_kOnMessageBegin] = function onMessageBegin() {
      currentHeaders.clear();
      currentMethod = '';
      currentUrl = '';
      // Reuse array instead of allocating new one (avoids GC pressure)
      bodyChunks.length = 0;
      bodyTotalLength = 0;
      expectedContentLength = 0;
    };

    parser[_kOnHeadersComplete] = function onHeadersComplete(
      versionMajor, versionMinor, headers, method, url
    ) {
      currentMethod = getHTTPMethods()[method] || 'GET';
      currentUrl = url;

      if (ArrayIsArray(headers)) {
        for (let i = 0; i < headers.length; i += 2) {
          const rawName = headers[i];
          const rawValue = headers[i + 1];
          const name = COMMON_HEADER_NAMES[rawName] || StringPrototypeToLowerCase(rawName);
          MapPrototypeSet(currentHeaders, name, rawValue);
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

    parser[_kOnBody] = function onBody(chunk, offset, length) {
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

    parser[_kOnMessageComplete] = function onMessageComplete() {
      pendingRequests++;
      try {
        const response = prepareAndDispatch();
        if (InternalUtilTypesIsPromise(response)) {
          response.then(finishResponse, handleError);
        } else {
          finishResponse(response);
        }
      } catch (error) {
        handleError(error);
      }
    };

    // Prepare request object and dispatch to handler (sync path)
    function prepareAndDispatch() {
      currentBody = bodyChunks.length === 0
        ? EMPTY_STRING
        : bodyChunks.length === 1
          ? bodyChunks[0].toString('utf8')
          : BufferConcat(bodyChunks, bodyTotalLength).toString('utf8');

      let pathname;
      let queryString;
      const host = MapPrototypeGet(currentHeaders, 'host') || 'localhost';

      // Use native C++ URL parser for fast pathname/query extraction.
      const parsedUrl = nativeParseUrl(currentUrl);
      if (parsedUrl !== undefined && parsedUrl !== null) {
        pathname = parsedUrl.pathname;
        queryString = parsedUrl.query;
      } else {
        // Fallback for malformed URLs.
        const questionIdx = StringPrototypeIndexOf(currentUrl, '?');
        if (questionIdx === -1) {
          pathname = currentUrl;
          queryString = undefined;
        } else {
          pathname = StringPrototypeSlice(currentUrl, 0, questionIdx);
          queryString = StringPrototypeSlice(currentUrl, questionIdx + 1);
        }
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
        // Native C++ query string parser with built-in URI decoding
        const parsed = nativeParseQueryString(queryString);
        const qsKeys = ObjectKeys(parsed);
        for (let qi = 0, qlen = qsKeys.length; qi < qlen; qi++) {
          request.query[qsKeys[qi]] = parsed[qsKeys[qi]];
        }
      }

      request._socket = socket;

      let response;
      const routeMatch = nativeMatchRoute(request.pathname);
      if (routeMatch) {
        const matchParams = routeMatch.params;
        const handler = handlerMap[routeMatch.handlerId];
        // Copy params from native result to request
        const paramKeys = ObjectKeys(matchParams);
        for (let pi = 0, plen = paramKeys.length; pi < plen; pi++) {
          request.params[paramKeys[pi]] = matchParams[paramKeys[pi]];
        }
        response = handler(request, serverInstance);
        if (response && InternalUtilTypesIsPromise(response)) {
          return response.then((resolved) => {
            if (resolved !== undefined) return resolved;
            const fetchResult = currentFetchHandler(request, serverInstance);
            return fetchResult;
          });
        }
      }

      if (response === undefined) {
        response = currentFetchHandler(request, serverInstance);
        // If handler returns a promise, return it directly for async handling
        if (response && InternalUtilTypesIsPromise(response)) {
          return response;
        }
      }

      return response;
    }

    // Write a Response object to the socket using single-buffer assembly
    function writeResponseObject(response) {
      const status = response.status || 200;
      const responseBody = response._bodyText !== undefined
        ? response._bodyText
        : undefined;

      // If we can't get the body synchronously, return false to fallback
      if (responseBody === undefined) return false;

      const bodyLen = Buffer.byteLength(responseBody);

      // Single-buffer assembly for small responses
      const cachedStatusLine = STATUS_LINE_CACHE[status];
      if (cachedStatusLine && bodyLen < SINGLE_BUF_THRESHOLD) {
        const headers = response.headers;
        const clBuf = bodyLen < CONTENT_LENGTH_CACHE_SIZE
          ? CONTENT_LENGTH_CACHE[bodyLen]
          : undefined;

        if (clBuf && !headers) {
          // Super fast path — no headers, no native isHeaders() call needed.
          const ctBuf = CT_TEXT_KEEPALIVE;
          // Super fast path: single buffer with all pre-computed parts
          const totalLen = cachedStatusLine.length + clBuf.length + ctBuf.length + bodyLen;
          const buf = BufferAllocUnsafe(totalLen);
          let offset = 0;
          offset += cachedStatusLine.copy(buf, offset);
          offset += clBuf.copy(buf, offset);
          offset += ctBuf.copy(buf, offset);
          buf.write(responseBody, offset);
          socket.write(buf);
          return true;
        }
      }

      return false;
    }

    function finishResponse(response) {
      try {
        // WebSocket upgrade — check WeakMap first (cheap); only do the
        // header Map lookup if server.upgrade() wasn't called explicitly.
        const upgradeInfo = pendingUpgrades.get(currentRequest);
        if (upgradeInfo !== undefined ||
            MapPrototypeGet(currentHeaders, 'upgrade') === 'websocket') {
          const wsKey = MapPrototypeGet(currentHeaders, 'sec-websocket-key');
          if (!wsKey) {
            socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
            releaseRequest(currentRequest);
            pendingRequests--;
            return;
          }

          const hash = CryptoCreateHash('sha1');
          hash.update(wsKey + WS_GUID);
          const acceptKey = hash.digest('base64');

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
          releaseRequest(currentRequest);
          pendingRequests--;
          return;
        }

        // Response dispatch — ordered by:
        //   1. undefined check first (eliminates truthy guards in all branches)
        //   2. typeof === 'string' (cheapest typeof, common for text endpoints)
        //   3. typeof === 'object' (covers both plain objects and Response/Buffer)
        //   4. fallback to 500
        if (response === undefined) {
          socket.write(HTTP_404);
        } else if (typeof response === 'string') {
          if (response.length === 0) {
            socket.write(HTTP_200_EMPTY);
          } else if (nativeWriteText(socket, 200, response)) {
            // Native fast path succeeded
          } else {
            const bodyLen = Buffer.byteLength(response);
            if (bodyLen < CONTENT_LENGTH_CACHE_SIZE) {
              const clBuf = CONTENT_LENGTH_CACHE[bodyLen];
              const totalLen = HTTP_200_TEXT.length + clBuf.length + bodyLen;
              const buf = BufferAllocUnsafe(totalLen);
              let offset = 0;
              offset += HTTP_200_TEXT.copy(buf, offset);
              offset += clBuf.copy(buf, offset);
              buf.write(response, offset);
              socket.write(buf);
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
        } else if (typeof response === 'object') {
          // Ordered by frequency: plain objects (JSON) > Response > Buffer.
          // typeof response.text is a single property check — cheaper than
          // BufferIsBuffer (native call). Plain objects have no .text property,
          // so this short-circuits to the JSON path without any native call.
          if (typeof response.text === 'function') {
            // Response object (has .text() method)
            if (writeResponseObject(response)) {
              releaseRequest(currentRequest);
              pendingRequests--;
              return;
            }

            const textPromise = response.text();
            if (InternalUtilTypesIsPromise(textPromise)) {
              textPromise.then((responseBody) => {
                writeResponseBody(response, responseBody);
                releaseRequest(currentRequest);
                pendingRequests--;
              }, (err) => {
                handleError(err);
              });
              return;
            }
            writeResponseBody(response, textPromise);
          } else if (BufferIsBuffer(response)) {
            // Buffer response
            if (nativeWriteBinary(socket, 200, response, 'application/octet-stream')) {
              // Native fast path succeeded
            } else {
              const bodyLen = response.length;
              if (bodyLen < CONTENT_LENGTH_CACHE_SIZE) {
                const clBuf = CONTENT_LENGTH_CACHE[bodyLen];
                const totalLen = HTTP_200_BINARY.length + clBuf.length + bodyLen;
                const buf = BufferAllocUnsafe(totalLen);
                let offset = 0;
                offset += HTTP_200_BINARY.copy(buf, offset);
                offset += clBuf.copy(buf, offset);
                response.copy(buf, offset);
                socket.write(buf);
              } else {
                socket.cork();
                socket.write(HTTP_200_BINARY);
                socket.write(StringCtor(bodyLen));
                socket.write(CRLF_BUF);
                socket.write(response);
                socket.uncork();
              }
            }
          } else {
            // Plain object — JSON serialization (most common for registry)
            const jsonBody = JSONStringify(response);
            if (!nativeWriteJson(socket, 200, jsonBody)) {
              const bodyLen = Buffer.byteLength(jsonBody);
              if (bodyLen < CONTENT_LENGTH_CACHE_SIZE) {
                const clBuf = CONTENT_LENGTH_CACHE[bodyLen];
                const totalLen = HTTP_200_JSON.length + clBuf.length + bodyLen;
                const buf = BufferAllocUnsafe(totalLen);
                let offset = 0;
                offset += HTTP_200_JSON.copy(buf, offset);
                offset += clBuf.copy(buf, offset);
                buf.write(jsonBody, offset);
                socket.write(buf);
              } else {
                socket.cork();
                socket.write(HTTP_200_JSON);
                socket.write(StringCtor(bodyLen));
                socket.write(CRLF_BUF);
                socket.write(jsonBody);
                socket.uncork();
              }
            }
          }
        } else {
          socket.write(HTTP_500);
        }

        releaseRequest(currentRequest);
      } catch (error) {
        handleError(error);
        return;
      }
      pendingRequests--;
    }

    // Write Response object body (after async text() resolution)
    function writeResponseBody(response, responseBody) {
      const status = response.status || 200;
      const bodyLen = Buffer.byteLength(responseBody);
      const headers = response.headers;

      // Single-buffer assembly for small responses
      const cachedStatusLine = STATUS_LINE_CACHE[status];
      if (cachedStatusLine && bodyLen < SINGLE_BUF_THRESHOLD && !headers) {
        const ctBuf = CT_TEXT_KEEPALIVE;
        const clBuf = bodyLen < CONTENT_LENGTH_CACHE_SIZE
          ? CONTENT_LENGTH_CACHE[bodyLen]
          : undefined;

        if (clBuf) {
          const totalLen = cachedStatusLine.length + clBuf.length + ctBuf.length + bodyLen;
          const buf = BufferAllocUnsafe(totalLen);
          let offset = 0;
          offset += cachedStatusLine.copy(buf, offset);
          offset += clBuf.copy(buf, offset);
          offset += ctBuf.copy(buf, offset);
          buf.write(responseBody, offset);
          socket.write(buf);
          return;
        }
      }

      socket.cork();

      if (cachedStatusLine && !headers) {
        socket.write(cachedStatusLine);
        if (bodyLen < CONTENT_LENGTH_CACHE_SIZE) {
          socket.write(CONTENT_LENGTH_CACHE[bodyLen]);
        } else {
          socket.write(StringCtor(bodyLen));
          socket.write('\r\n');
        }
        socket.write(CT_TEXT_KEEPALIVE);
      } else if (cachedStatusLine) {
        socket.write(cachedStatusLine);
        if (bodyLen < CONTENT_LENGTH_CACHE_SIZE) {
          socket.write(CONTENT_LENGTH_CACHE[bodyLen]);
        } else {
          socket.write(StringCtor(bodyLen));
          socket.write('\r\n');
        }
        const headersOk = isHeaders(headers);
        const contentType = headersOk ? headers.get('content-type') : undefined;
        const cachedCtHeader = contentType && CONTENT_TYPE_HEADERS[contentType];
        if (cachedCtHeader) {
          socket.write(cachedCtHeader);
        } else {
          socket.write(KEEP_ALIVE_HEADER);
          if (headersOk) {
            headers.forEach((value, name) => {
              // Headers.forEach yields lowercase names per the Fetch spec.
              if (name !== 'content-length' && name !== 'connection') {
                socket.write(`${name}: ${value}\r\n`);
              }
            });
          }
          socket.write('\r\n');
        }
      } else {
        const statusText = response.statusText || STATUS_TEXT[status] || EMPTY_STRING;
        socket.write(`HTTP/1.1 ${status} ${statusText}\r\nContent-Length: ${bodyLen}\r\n`);
        socket.write(KEEP_ALIVE_HEADER);
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
      socket.write(responseBody);
      socket.uncork();
    }

    function handleError(error) {
      try {
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
            const textResult = errorResponse.text();
            if (InternalUtilTypesIsPromise(textResult)) {
              textResult.then((responseBody) => {
                writeErrorResponse(errorResponse, responseBody);
                releaseRequest(currentRequest);
                pendingRequests--;
              }, () => {
                socket.write(HTTP_500);
                releaseRequest(currentRequest);
                pendingRequests--;
              });
              return;
            }
            writeErrorResponse(errorResponse, textResult);
          } catch {
            socket.write(HTTP_500);
          }
        } else {
          socket.write(HTTP_500);
        }
      } catch {
        socket.write(HTTP_500);
      }
      releaseRequest(currentRequest);
      pendingRequests--;
    }

    function writeErrorResponse(errorResponse, responseBody) {
      const status = errorResponse.status || 500;
      const bodyLen = Buffer.byteLength(responseBody);
      const headers = errorResponse.headers;
      const headersOk = isHeaders(headers);

      socket.cork();

      const cachedStatusLine = STATUS_LINE_CACHE[status];
      if (cachedStatusLine) {
        socket.write(cachedStatusLine);
        if (bodyLen < CONTENT_LENGTH_CACHE_SIZE) {
          socket.write(CONTENT_LENGTH_CACHE[bodyLen]);
        } else {
          socket.write(StringCtor(bodyLen));
          socket.write('\r\n');
        }
        const contentType = headersOk ? headers.get('content-type') : undefined;
        const cachedCtHeader = contentType && CONTENT_TYPE_HEADERS[contentType];
        if (cachedCtHeader) {
          socket.write(cachedCtHeader);
        } else {
          socket.write(KEEP_ALIVE_HEADER);
          if (headersOk) {
            headers.forEach((value, name) => {
              // Headers.forEach yields lowercase names per the Fetch spec.
              if (name !== 'content-length' && name !== 'connection') {
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
      socket.write(responseBody);
      socket.uncork();
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

  // Apply TCP optimizations on the listen socket fd.
  // TCP_FASTOPEN, TCP_DEFER_ACCEPT, and buffer sizes are applied via native
  // setsockopt. reusePort is handled by net.Server.listen() via UV_TCP_REUSEPORT.
  // TCP_NODELAY is set per-connection in handleConnection.
  function applyTcpOptimizations() {
    const handle = netServer._handle;
    if (!handle) return;

    // Get the fd from the libuv handle
    const fd = handle.fd;
    if (fd === undefined || fd < 0) return;

    smolHttp().applyTcpListenOpts(fd);
  }

  // Listen — synchronous bind when host is omitted or is an IP address.
  //
  // CRITICAL: Node.js's net.Server.listen() does async DNS lookup when
  // `host` is specified (even for '0.0.0.0'). To get synchronous binding:
  // - Omit `host` for unspecified address (0.0.0.0/::) — Node defaults to
  //   dual-stack :: with IPv4 fallback, and binds synchronously.
  // - Pass `host` only for specific non-default addresses.
  //
  // Without this, netServer.address() returns null after listen() because
  // the bind is deferred to the DNS callback.
  const listenOpts = { __proto__: null, ipv6Only, reusePort };

  if (unixPath) {
    netServer.listen(unixPath, () => {
      applyTcpOptimizations();
    });
    actualPort = 0;
  } else {
    // Only pass host when it's not the default unspecified address.
    // Omitting host avoids async dns.lookup() and makes bind synchronous.
    const isDefaultHost = hostname === '0.0.0.0' || hostname === '::' || hostname === '';
    const opts = {
      __proto__: null,
      ...listenOpts,
      port: requestedPort,
    };
    if (!isDefaultHost) {
      // Resolve localhost synchronously to avoid dns.lookup()
      opts.host = hostname === 'localhost' ? '127.0.0.1' : hostname;
    }

    netServer.listen(opts, () => {
      applyTcpOptimizations();
    });

    // Read the actual port synchronously — the bind already happened
    // (when host is omitted, Node calls listenInCluster → _listen2
    // which does synchronous uv_tcp_bind + uv_listen).
    const addr = netServer.address();
    if (addr && typeof addr === 'object') {
      actualPort = addr.port;
    }
  }

  return serverInstance;
}

module.exports = {
  __proto__: null,
  serve,
};
