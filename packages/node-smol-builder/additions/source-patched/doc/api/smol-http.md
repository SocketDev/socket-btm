# HTTP

<!--introduced_in=v23.0.0-->

> Stability: 1 - Experimental

<!-- source_link=lib/smol-http.js -->

High-performance HTTP utilities with a Bun-compatible `serve()` API, fast
response writers, caching systems, and HTTP/2 helpers.

```mjs
import http from 'node:smol-http';
// or
import { serve, fastJsonResponse } from 'node:smol-http';
```

```cjs
const http = require('node:smol-http');
// or
const { serve, fastJsonResponse } = require('node:smol-http');
```

## `serve(options)`

<!-- YAML
added: v23.0.0
-->

* `options` {Object}
  * `port` {number} Port to listen on. **Default:** `3000`
  * `hostname` {string} Hostname to bind to. **Default:** `'0.0.0.0'`
  * `fetch` {Function} Request handler function. Receives `(request, server)`.
  * `error` {Function} Error handler function. **Optional.**
  * `key` {Buffer|string} TLS private key. **Optional.**
  * `cert` {Buffer|string} TLS certificate. **Optional.**
  * `tls` {Object} TLS options object. **Optional.**
* Returns: {Object} Server instance with `stop()` method.

Creates an HTTP server using the Bun.serve-style API. The `fetch` handler
receives a Web Standard `Request` object and should return a `Response` object
(or a value that can be converted to one).

```mjs
import { serve } from 'node:smol-http';

const server = serve({
  port: 3000,
  fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === '/json') {
      return new Response(JSON.stringify({ hello: 'world' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('Hello, World!');
  },
});

console.log(`Server running at http://localhost:${server.port}`);
```

### Response types

The `fetch` handler can return:

* `Response` - Web Standard Response object
* `string` - Converted to text/plain Response
* `Object` - JSON stringified with application/json Content-Type
* `Buffer`/`Uint8Array` - Binary response

## Fast response functions

Native-optimized response functions that bypass JavaScript overhead for
maximum performance.

### `fastJsonResponse(res, data[, statusCode])`

<!-- YAML
added: v23.0.0
-->

* `res` {http.ServerResponse} The response object.
* `data` {Object|string} JSON data (object will be stringified).
* `statusCode` {number} HTTP status code. **Default:** `200`

Writes a JSON response with optimal performance using native bindings.

```mjs
import { createServer } from 'node:http';
import { fastJsonResponse } from 'node:smol-http';

createServer((req, res) => {
  fastJsonResponse(res, { status: 'ok', timestamp: Date.now() });
}).listen(3000);
```

### `fastBinaryResponse(res, buffer[, contentType][, statusCode])`

<!-- YAML
added: v23.0.0
-->

* `res` {http.ServerResponse} The response object.
* `buffer` {Buffer} Binary data to send.
* `contentType` {string} Content-Type header. **Default:** `'application/octet-stream'`
* `statusCode` {number} HTTP status code. **Default:** `200`

Writes binary data with optimal performance.

### `fastErrorResponse(res, statusCode[, message])`

<!-- YAML
added: v23.0.0
-->

* `res` {http.ServerResponse} The response object.
* `statusCode` {number} HTTP status code.
* `message` {string} Error message. **Optional.**

Writes an error response.

### `fastNotModified(res[, etag])`

<!-- YAML
added: v23.0.0
-->

* `res` {http.ServerResponse} The response object.
* `etag` {string} ETag header value. **Optional.**

Sends a 304 Not Modified response.

### `fastPackumentResponse(res, data[, etag])`

<!-- YAML
added: v23.0.0
-->

* `res` {http.ServerResponse} The response object.
* `data` {Object|string} Package metadata (packument).
* `etag` {string} ETag header. **Optional.**

Optimized response for npm package metadata.

### `fastTarballResponse(res, buffer[, etag])`

<!-- YAML
added: v23.0.0
-->

* `res` {http.ServerResponse} The response object.
* `buffer` {Buffer} Tarball data.
* `etag` {string} ETag header. **Optional.**

Optimized response for npm package tarballs.

## Response writers

Higher-level response writing functions.

### `writeJsonResponse(res, statusCode, data[, headers])`

<!-- YAML
added: v23.0.0
-->

* `res` {http.ServerResponse} The response object.
* `statusCode` {number} HTTP status code.
* `data` {Object} JSON data.
* `headers` {Object} Additional headers. **Optional.**

Writes a JSON response with specified status and headers.

### `writeNotFound(res[, message])`

<!-- YAML
added: v23.0.0
-->

* `res` {http.ServerResponse} The response object.
* `message` {string} Custom 404 message. **Optional.**

Writes a 404 Not Found response.

### `writeNotModified(res[, etag])`

<!-- YAML
added: v23.0.0
-->

* `res` {http.ServerResponse} The response object.
* `etag` {string} ETag header. **Optional.**

Writes a 304 Not Modified response.

### `writeTarballResponse(res, buffer[, headers])`

<!-- YAML
added: v23.0.0
-->

* `res` {http.ServerResponse} The response object.
* `buffer` {Buffer} Tarball data.
* `headers` {Object} Additional headers. **Optional.**

Writes a tarball response with appropriate headers.

## Cork management

### Class: `CorkManager`

<!-- YAML
added: v23.0.0
-->

Manages socket corking for batched writes.

#### `new CorkManager(socket)`

* `socket` {net.Socket} The socket to manage.

#### `corkManager.cork()`

Corks the socket to buffer writes.

#### `corkManager.uncork()`

Uncorks the socket to flush buffered writes.

### `withCork(socket, fn)`

<!-- YAML
added: v23.0.0
-->

* `socket` {net.Socket} The socket to cork.
* `fn` {Function} Function to execute while corked.
* Returns: Result of `fn()`.

Executes a function with the socket corked, automatically uncorking afterward.

```mjs
import { withCork } from 'node:smol-http';

withCork(res.socket, () => {
  res.writeHead(200);
  res.write('chunk1');
  res.write('chunk2');
  res.end();
});
```

## Header cache

Cached header generation for performance.

### `getStatusLine(statusCode)`

<!-- YAML
added: v23.0.0
-->

* `statusCode` {number} HTTP status code.
* Returns: {string} Cached status line (e.g., `'HTTP/1.1 200 OK\r\n'`).

### `getContentLength(length)`

<!-- YAML
added: v23.0.0
-->

* `length` {number} Content length.
* Returns: {string} Cached Content-Length header.

### `getHeader(name, value)`

<!-- YAML
added: v23.0.0
-->

* `name` {string} Header name.
* `value` {string} Header value.
* Returns: {string} Formatted header line.

## JSON cache

High-performance JSON stringification with caching.

### `stringifyWithCache(data[, key])`

<!-- YAML
added: v23.0.0
-->

* `data` {Object} Data to stringify.
* `key` {string} Cache key. **Optional.**
* Returns: {string} JSON string.

Stringifies JSON with optional caching for repeated serialization.

### `getCachedJson(key)`

<!-- YAML
added: v23.0.0
-->

* `key` {string} Cache key.
* Returns: {string|undefined} Cached JSON string or undefined.

Retrieves cached JSON by key.

### `createCacheKey(data)`

<!-- YAML
added: v23.0.0
-->

* `data` {Object} Data to create key from.
* Returns: {string} Cache key.

Creates a cache key for the given data.

### `invalidate(key)`

<!-- YAML
added: v23.0.0
-->

* `key` {string} Cache key to invalidate.

Removes an entry from the JSON cache.

### `clearCache()`

<!-- YAML
added: v23.0.0
-->

Clears the entire JSON cache.

### `getCacheStats()`

<!-- YAML
added: v23.0.0
-->

* Returns: {Object} Cache statistics including hits, misses, and size.

## Class: `ETagCache`

<!-- YAML
added: v23.0.0
-->

Cache for ETag values.

### `new ETagCache([maxSize])`

* `maxSize` {number} Maximum cache entries. **Default:** `10000`

### `etagCache.get(key)`

* `key` {string} Cache key.
* Returns: {string|undefined} Cached ETag.

### `etagCache.set(key, etag)`

* `key` {string} Cache key.
* `etag` {string} ETag value.

### `etagCache`

<!-- YAML
added: v23.0.0
-->

Default `ETagCache` instance.

## Class: `AuthCache`

<!-- YAML
added: v23.0.0
-->

Cache for authentication tokens/results.

### `authCache`

<!-- YAML
added: v23.0.0
-->

Default `AuthCache` instance.

## Class: `CompressionCache`

<!-- YAML
added: v23.0.0
-->

Cache for pre-compressed responses.

### `compressionCache`

<!-- YAML
added: v23.0.0
-->

Default `CompressionCache` instance.

## Version subsetting

Utilities for npm packument version filtering.

### `subsetPackument(packument, range)`

<!-- YAML
added: v23.0.0
-->

* `packument` {Object} Full package metadata.
* `range` {string} Semver range to filter versions.
* Returns: {Object} Filtered packument.

Returns a packument with only versions matching the semver range.

### `semver`

<!-- YAML
added: v23.0.0
-->

Semver utilities object.

### `getSubsetStats()`

<!-- YAML
added: v23.0.0
-->

* Returns: {Object} Subset operation statistics.

## Class: `DependencyGraph`

<!-- YAML
added: v23.0.0
-->

Tracks package dependencies for HTTP/2 push optimization.

### `dependencyGraph`

<!-- YAML
added: v23.0.0
-->

Default `DependencyGraph` instance.

## HTTP/2 helpers

### `createHttp2Server(options)`

<!-- YAML
added: v23.0.0
-->

* `options` {Object} Server options.
* Returns: {http2.Http2SecureServer}

Creates an HTTP/2 server with optimized settings.

### `optimizeHttp2Session(session)`

<!-- YAML
added: v23.0.0
-->

* `session` {http2.Http2Session} Session to optimize.

Applies performance optimizations to an HTTP/2 session.

### `sendWithPreloads(stream, data, preloads)`

<!-- YAML
added: v23.0.0
-->

* `stream` {http2.Http2Stream} Response stream.
* `data` {Buffer|string} Main response data.
* `preloads` {Array} Resources to push.

Sends response with HTTP/2 server push for related resources.

### `sendPackumentWithDeps(stream, packument)`

<!-- YAML
added: v23.0.0
-->

* `stream` {http2.Http2Stream} Response stream.
* `packument` {Object} Package metadata.

Sends packument with HTTP/2 push for dependencies.

### `getHttp2Stats()`

<!-- YAML
added: v23.0.0
-->

* Returns: {Object} HTTP/2 performance statistics.
