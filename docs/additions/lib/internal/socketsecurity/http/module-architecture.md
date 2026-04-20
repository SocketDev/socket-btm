# node:smol-http Module Architecture

## Module Hierarchy

```
node:smol-http (lib/smol-http.js)
  └── internal/socketsecurity/http (barrel — all exports)
        ├── internal/socketsecurity/http/core (bootstrap-safe)
        │     ├── server.js ──── uWS-backed serve() API
        │     ├── fast_response.js ── native C++ response writers
        │     ├── response_writer.js
        │     ├── header_cache.js
        │     └── cork_manager.js
        ├── json_cache.js ─── JSON stringify cache with LRU
        ├── etag_cache.js ─── ETag generation + caching (lazy singleton)
        ├── auth_cache.js ─── Bearer token TTL cache (lazy singleton)
        ├── compression_cache.js ── Brotli/gzip cache (lazy singleton)
        ├── version_subset.js ── Semver-based packument subsetting
        ├── dependency_graph.js ── Dep resolution + Link preload
        └── http2_helpers.js ── HTTP/2 server helpers (lazy http2 import)
```

## Bootstrap Safety

Node.js loads `_http_server.js` during bootstrap, before `process.env`,
`debuglog`, and some timer APIs are fully initialized. Our patch to
`_http_server.js` imports `internal/socketsecurity/http/core` — the
bootstrap-safe subset.

**Rule:** `core.js` and everything it imports must NOT:

- Call `setInterval()`, `setTimeout()`, or `setImmediate()` at module scope
- Access `process.env` at module scope
- Use `debuglog()` or `createDebug()` at module scope
- Require `http2` (triggers debuglog)
- Create singleton caches (they use timers for auto-purge)

**Heavy modules** (caches, http2) are only loaded when:

1. User code does `require('node:smol-http')` (loads the full barrel)
2. Registry server code imports specific cache modules directly

## Patch Philosophy

Our patches to upstream Node.js files (`_http_server.js`, `node.gyp`, etc.)
follow a strict **additions-only** policy:

- **Never delete** upstream lines — only add new ones
- **Import alongside**, don't replace — if upstream has `const http = require('http')`,
  we add `const httpPerf = require('internal/socketsecurity/http/core')` on a new line
- **Re-export to shadow** — add our module to `module.exports` without removing theirs
- **Minimal hunks** — each patch touches as few lines as possible

This makes patches resilient to upstream Node.js changes and easy to rebase.

## safe-references.js

Single file that captures references to Node.js builtins at require time,
protecting against prototype pollution. For modules that can't be loaded
during bootstrap (like `http2`), we use a lazy wrapper module:

```
safe-references.js
  → require('internal/socketsecurity/http2-refs')  // lazy, returns getter
      → require('http2')  // only on first property access
```

## Performance Architecture

### uWS Path (serve() API)

```
HTTP request → uWebSockets C++ parser (zero-copy)
  → uWS cork buffer (16KB, per-loop)
    → JS handler call (V8)
      → response type dispatch (C++ WriteResponse)
        → uWS cork flush → single send() syscall
```

### Non-serve APIs (fastJsonResponse, writePrecomputed, etc.)

Used by registry code that handles responses directly on `net.Socket`:

```
JS code calls fastJsonResponse(socket, status, json)
  → C++ FastResponse::WriteJson()
    → BuildHeaders() (memcpy pre-computed parts, hand-rolled itoa)
    → GetUvStream() (socket._handle → LibuvStreamWrap → uv_stream_t)
    → TryWrite2() (writev headers+body → uv_try_write → single syscall)
```

Both paths achieve zero heap allocation in the response hot path.
