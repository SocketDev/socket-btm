node:smol-http — High-Performance HTTP Utilities

Public entry point. Re-exports everything from the internal barrel.
Loaded on-demand when user code does `require('node:smol-http')` or
`import from 'node:smol-http'` — NOT during Node.js bootstrap.

Module architecture — all files are siblings under
`internal/socketsecurity/http/`. `core.js` is a facade that
lazy-requires the bootstrap-safe subset, not a subdirectory.

node:smol-http (this file)
└── internal/socketsecurity/http/ (all modules are siblings)
    ├── core.js (facade → lazy-loads bootstrap-safe subset below)
    ├── server.js (uWS-backed serve(), bootstrap-safe)
    ├── fast_response.js (native C++ response writers, bootstrap-safe)
    ├── response_writer.js (bootstrap-safe)
    ├── header_cache.js (bootstrap-safe)
    ├── cork_manager.js (bootstrap-safe)
    ├── client.js
    ├── pools.js
    ├── constants.js
    ├── json_cache.js
    ├── etag_cache.js (lazy singleton)
    ├── auth_cache.js (lazy singleton)
    ├── compression_cache.js (lazy singleton)
    ├── version_subset.js
    ├── dependency_graph.js
    └── http2_helpers.js (lazy http2 import)
