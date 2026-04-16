node:smol-http — High-Performance HTTP Utilities

Public entry point. Re-exports everything from the internal barrel.
Loaded on-demand when user code does `require('node:smol-http')` or
`import from 'node:smol-http'` — NOT during Node.js bootstrap.

Module architecture:
node:smol-http (this file)
└── internal/socketsecurity/http (barrel — all exports)
├── internal/socketsecurity/http/core (bootstrap-safe)
│ ├── server.js (uWS-backed serve())
│ ├── fast_response.js (native C++ response writers)
│ ├── response_writer.js
│ ├── header_cache.js
│ └── cork_manager.js
├── json_cache.js
├── etag_cache.js (lazy singleton)
├── auth_cache.js (lazy singleton)
├── compression_cache.js (lazy singleton)
├── version_subset.js
├── dependency_graph.js
└── http2_helpers.js (lazy http2 import)
