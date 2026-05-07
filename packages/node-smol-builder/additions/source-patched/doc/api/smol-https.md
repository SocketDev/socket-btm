# HTTPS

<!--introduced_in=v23.0.0-->

> Stability: 1 - Experimental

<!-- source_link=lib/smol-https.js -->

HTTPS server using the smol-http `serve()` API with TLS.

This module is a thin wrapper around `node:smol-http` that requires TLS
configuration and defaults to port 443. For HTTP utilities like caching and
fast response functions, import from `node:smol-http` directly.

```mjs
import https from 'node:smol-https'
// or
import { serve } from 'node:smol-https'
```

```cjs
const https = require('node:smol-https')
// or
const { serve } = require('node:smol-https')
```

## `serve(options)`

<!-- YAML
added: v23.0.0
-->

- `options` {Object}
  - `port` {number} Port to listen on. **Default:** `443`
  - `hostname` {string} Hostname to bind to. **Default:** `'0.0.0.0'`
  - `key` {Buffer|string} TLS private key. **Required** (unless `tls` provided).
  - `cert` {Buffer|string} TLS certificate. **Required** (unless `tls` provided).
  - `ca` {Buffer|string} TLS CA certificate(s). **Optional.**
  - `passphrase` {string} Passphrase for private key. **Optional.**
  - `tls` {Object} TLS options object (alternative to individual options).
  - `fetch` {Function} Request handler function.
- Returns: {Object} Server instance with `stop()` method.
- Throws: {TypeError} If no TLS options are provided.

Creates an HTTPS server. Unlike `node:smol-http`, TLS options are required.

```mjs
import { serve } from 'node:smol-https'
import { readFileSync } from 'node:fs'

const server = serve({
  port: 443,
  key: readFileSync('server.key'),
  cert: readFileSync('server.cert'),
  fetch(req) {
    return new Response('Hello, HTTPS!')
  },
})

console.log(`HTTPS server running at https://localhost:${server.port}`)
```

### Using a TLS options object

You can pass any Node.js `tls.createServer()` options via the `tls` property:

```mjs
import { serve } from 'node:smol-https'
import { readFileSync } from 'node:fs'

const server = serve({
  tls: {
    key: readFileSync('server.key'),
    cert: readFileSync('server.cert'),
    minVersion: 'TLSv1.2',
    ciphers: 'ECDHE-RSA-AES128-GCM-SHA256',
  },
  fetch(req) {
    return new Response('Secure!')
  },
})
```

### Error handling

If TLS options are not provided, `serve()` throws a `TypeError`:

```mjs
import { serve } from 'node:smol-https'

// This will throw:
// TypeError: node:smol-https requires TLS options.
// Provide key/cert options or a tls options object.
// For HTTP without TLS, use node:smol-http instead.
serve({
  fetch(req) {
    return new Response('Hello')
  },
})
```

## Comparison with `node:smol-http`

| Feature           | `node:smol-http` | `node:smol-https`     |
| ----------------- | ---------------- | --------------------- |
| Default port      | 3000             | 443                   |
| TLS required      | No               | Yes                   |
| Fast responses    | Yes              | Import from smol-http |
| Caching utilities | Yes              | Import from smol-http |
| HTTP/2 helpers    | Yes              | Import from smol-http |

For most use cases, you'll want to import utilities from `node:smol-http` and
only use `node:smol-https` for the `serve()` function:

```mjs
import { serve } from 'node:smol-https'
import { fastJsonResponse, ETagCache } from 'node:smol-http'
import { readFileSync } from 'node:fs'

const server = serve({
  key: readFileSync('server.key'),
  cert: readFileSync('server.cert'),
  fetch(req) {
    // Use smol-http utilities
    return new Response(JSON.stringify({ secure: true }), {
      headers: { 'Content-Type': 'application/json' },
    })
  },
})
```
