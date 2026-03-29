# node:smol-http - High-Performance HTTP Server

A high-performance HTTP server with Bun.serve-compatible API. Designed for maximum throughput with minimal latency.

## What is smol-http?

**smol-http** provides a fast HTTP server that bypasses much of Node.js's HTTP stack overhead. It uses native C++ bindings for response writing, object pooling to reduce GC pressure, and pre-computed buffers to eliminate allocations on hot paths.

**Key features:**

- Bun.serve-compatible API
- Native C++ response writers (25-40% faster)
- Trie-based router with O(log n) matching
- WebSocket support with pub/sub
- Object pooling (zero GC on hot paths)

## Quick Start

```javascript
import { serve } from 'node:smol-http'

const server = serve({
  port: 3000,
  fetch(request, server) {
    return new Response('Hello World!')
  },
})

console.log(`Listening on ${server.url}`)
```

## When to Use

Use `node:smol-http` when you need:

- Maximum requests per second
- Low latency responses
- Bun.serve compatibility on Node.js
- WebSocket support with pub/sub
- Route parameter handling

## API Reference

### Creating a Server

#### `serve(options)`

Create and start an HTTP server.

```javascript
const server = serve({
  port: 3000, // Port to listen on (default: 3000)
  hostname: '0.0.0.0', // Hostname to bind (default: '0.0.0.0')

  // Main request handler
  fetch(request, server) {
    return new Response('Hello')
  },

  // Optional: Route handlers (trie-based, faster than fetch)
  routes: {
    '/api/users/:id': (req, server) => {
      return new Response(`User: ${req.params.id}`)
    },
    '/static/*': handleStatic,
  },

  // Optional: WebSocket handlers
  websocket: {
    open(ws) {},
    message(ws, data) {},
    close(ws, code, reason) {},
  },

  // Optional: Error handler
  error(err) {
    return new Response('Error', { status: 500 })
  },

  // Optional: Settings
  idleTimeout: 10, // Connection timeout in seconds
  maxBodySize: 10 * 1024 * 1024, // Max request body (10MB)
  development: false, // Enable dev mode logging
})
```

### Server Instance

#### Properties

```javascript
server.port // Actual port (useful when port: 0)
server.hostname // Bound hostname
server.url // Full URL (e.g., http://localhost:3000/)
server.development // Whether in development mode
server.pendingRequests // Number of in-flight requests
server.pendingWebSockets // Number of active WebSocket connections
```

#### Methods

```javascript
// Stop the server
await server.stop()
await server.stop(true) // Force close active connections

// Hot reload handlers
server.reload({
  fetch: newFetchHandler,
  routes: newRoutes,
  websocket: newWsHandlers,
})

// WebSocket pub/sub
server.publish('topic', 'message') // Send to all subscribers
server.subscriberCount('topic') // Count subscribers

// Get client IP
const ip = server.requestIP(request)
// => { address: '127.0.0.1', port: 54321, family: 'IPv4' }

// Upgrade to WebSocket
server.upgrade(request, { data: userData })
```

### Request Object

The request object passed to handlers:

```javascript
request.method // 'GET', 'POST', etc.
request.url // Full URL string
request.pathname // URL path (e.g., '/api/users')
request.headers // Headers object
request.params // Route parameters (e.g., { id: '123' })
request.query // Query parameters (e.g., { page: '1' })
request.body // Raw body string

// Body parsing methods
const text = await request.text()
const json = await request.json()
const buffer = await request.arrayBuffer()
```

### Response Handling

Return any of these from your handler:

```javascript
// Response object (standard)
return new Response('Hello', {
  status: 200,
  headers: { 'Content-Type': 'text/plain' },
})

// Plain string (fast path - text/plain)
return 'Hello World'

// Object (fast path - JSON)
return { message: 'ok', data: [1, 2, 3] }

// Buffer (fast path - binary)
return Buffer.from([0x00, 0x01, 0x02])

// undefined/null returns 404
return undefined
```

### Route Patterns

Routes support static paths, parameters, and wildcards:

```javascript
routes: {
  // Static path
  '/api/health': handleHealth,

  // Parameter (captured in req.params)
  '/api/users/:id': (req) => {
    return new Response(`User ${req.params.id}`);
  },

  // Multiple parameters
  '/api/:org/:repo/issues/:id': (req) => {
    const { org, repo, id } = req.params;
    // ...
  },

  // Wildcard (captures rest of path)
  '/static/*': (req) => {
    const path = req.params['$wildcard'];
    // ...
  },

  // Method-specific handlers
  '/api/users': {
    GET: listUsers,
    POST: createUser,
    '*': methodNotAllowed,  // Fallback
  },
}
```

### WebSocket Support

#### Server Configuration

```javascript
serve({
  fetch(req, server) {
    // Upgrade HTTP to WebSocket
    if (req.headers.get('upgrade') === 'websocket') {
      server.upgrade(req, { data: { userId: 123 } })
      return // Return nothing after upgrade
    }
    return new Response('Hello')
  },

  websocket: {
    open(ws) {
      console.log('Connected:', ws.remoteAddress)
      ws.subscribe('chat') // Subscribe to topic
    },

    message(ws, data) {
      // Echo back
      ws.send(data)

      // Or broadcast to topic
      ws.publish('chat', data)
    },

    close(ws, code, reason) {
      console.log('Disconnected:', code, reason)
    },

    // Optional handlers
    ping(ws, data) {},
    pong(ws, data) {},
    drain(ws) {}, // Buffer drained, can send more
    error(ws, err) {},
  },
})
```

#### WebSocket Object

```javascript
ws.send(data)           // Send text or binary
ws.sendText(text)       // Send as text frame
ws.sendBinary(buffer)   // Send as binary frame
ws.close(code?, reason?) // Close connection
ws.ping(data?)          // Send ping
ws.pong(data?)          // Send pong

ws.subscribe(topic)     // Subscribe to pub/sub topic
ws.unsubscribe(topic)   // Unsubscribe from topic
ws.isSubscribed(topic)  // Check subscription
ws.publish(topic, data) // Publish to topic (excludes self)
ws.subscriptions        // Array of subscribed topics

ws.cork(callback)       // Batch multiple sends
ws.terminate()          // Force close without handshake

ws.readyState           // 0=CONNECTING, 1=OPEN, 2=CLOSING, 3=CLOSED
ws.remoteAddress        // Client IP address
ws.data                 // User data from upgrade()
```

### TLS/HTTPS

```javascript
import { serve } from 'node:smol-https'

serve({
  port: 443,

  // TLS options (any of these work)
  tls: {
    key: fs.readFileSync('key.pem'),
    cert: fs.readFileSync('cert.pem'),
  },
  // Or directly:
  key: fs.readFileSync('key.pem'),
  cert: fs.readFileSync('cert.pem'),

  fetch(req) {
    return new Response('Secure!')
  },
})
```

## Performance

### Native C++ Response Writers

The `smol_http` C++ binding writes HTTP responses directly to the socket, bypassing Node.js's HTTP stack:

```javascript
// These use native writers automatically:
return { data: 'json' };     // nativeWriteJson  - 25-40% faster
return 'text';               // nativeWriteText  - 25-40% faster
return Buffer.from([...]);   // nativeWriteBinary - 25-40% faster
```

**Why it's faster:**

- Skips Node.js `http.ServerResponse` object creation
- No JavaScript callbacks for write completion
- Direct buffer-to-socket writes via libuv
- Headers and body written in single syscall

### Pre-computed Response Buffers

Common HTTP headers are pre-computed as Buffers at module load:

```javascript
// Pre-computed at startup (zero runtime cost):
HTTP_200_JSON // 'HTTP/1.1 200 OK\r\nContent-Type: application/json...'
HTTP_200_TEXT // 'HTTP/1.1 200 OK\r\nContent-Type: text/plain...'
HTTP_200_BINARY // 'HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream...'
HTTP_404 // Complete 404 response

// Content-Length cache for sizes 0-9999 (covers 99% of responses):
CONTENT_LENGTH_CACHE[42] // 'Content-Length: 42\r\n\r\n' as Buffer
```

**Impact:** Eliminates string concatenation and Buffer.from() on every request.

### Zero-GC Object Pooling

Request objects, route params, and HTTP parsers are pooled and reused:

```javascript
// Internal flow - no allocations on hot path:
const req = requestPool.acquire() // Reuse existing object
const params = paramsPool.acquire() // Reuse params object
// ... handle request ...
paramsPool.release(params) // Return to pool
requestPool.release(req) // Return to pool
```

**Pool sizes:**

- Request pool: 1000 objects
- Params pool: 500 objects
- Parser pool: 100 objects

### Trie-Based Router

Routes compiled to a trie (prefix tree) for O(log n) matching:

```javascript
// Trie structure for routes:
// /api/users/:id  →  /→api→/→users→/→:id
// /api/posts/:id  →  /→api→/→posts→/→:id
//                         ↑ shared prefix

// Fast - single trie traversal
routes: { '/api/users/:id': handler }

// Slower - sequential string comparisons in fetch
fetch(req) { if (req.pathname === '/api/users') ... }
```

**Matching cost:**

- Trie: O(path length) character comparisons
- Linear: O(n × path length) for n routes

### Cork/Uncork TCP Batching

Multiple writes batched into single TCP packets:

```javascript
socket.cork() // Hold writes
socket.write(headers) // Queued
socket.write(body) // Queued
socket.uncork() // Single TCP packet sent

// Without cork: 2 packets, 2 syscalls
// With cork: 1 packet, 1 syscall
```

### Throughput Benchmarks

| Scenario      | Requests/sec | vs Node.js http |
| ------------- | ------------ | --------------- |
| JSON response | 70-80K       | +100-130%       |
| Text response | 75-85K       | +100-130%       |
| Route params  | 65-75K       | +90-120%        |
| WebSocket msg | 500K+        | N/A             |

### WebSocket Optimizations

- **SIMD frame masking** - AVX2/NEON accelerated XOR for payload masking
- **Zero-copy pub/sub** - Messages broadcast without per-subscriber copies
- **Binary frame encoding** - Native C++ frame construction

## Common Patterns

### JSON API

```javascript
serve({
  routes: {
    '/api/users': {
      GET: async req => {
        const users = await db.getUsers()
        return users // Auto-serialized to JSON
      },
      POST: async req => {
        const data = await req.json()
        const user = await db.createUser(data)
        return new Response(JSON.stringify(user), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        })
      },
    },
  },
})
```

### Static Files

```javascript
import { readFileSync } from 'fs'

serve({
  routes: {
    '/static/*': req => {
      const path = req.params['$wildcard']
      try {
        const content = readFileSync(`./public/${path}`)
        return new Response(content, {
          headers: { 'Content-Type': getMimeType(path) },
        })
      } catch {
        return new Response('Not Found', { status: 404 })
      }
    },
  },
})
```

### Middleware Pattern

```javascript
function withAuth(handler) {
  return async (req, server) => {
    const token = req.headers.get('authorization')
    if (!token) {
      return new Response('Unauthorized', { status: 401 })
    }
    req.user = await validateToken(token)
    return handler(req, server)
  }
}

serve({
  routes: {
    '/api/protected': withAuth(req => {
      return { user: req.user }
    }),
  },
})
```

### Chat Room with WebSocket

```javascript
serve({
  fetch(req, server) {
    if (req.pathname === '/chat') {
      const username = req.query.name || 'anonymous'
      server.upgrade(req, { data: { username } })
      return
    }
    return new Response('Use /chat?name=yourname')
  },

  websocket: {
    open(ws) {
      ws.subscribe('chat')
      server.publish('chat', `${ws.data.username} joined`)
    },

    message(ws, msg) {
      server.publish('chat', `${ws.data.username}: ${msg}`)
    },

    close(ws) {
      server.publish('chat', `${ws.data.username} left`)
    },
  },
})
```

## Performance Tips

1. **Use routes over fetch** - Trie matching is faster than string comparison in fetch.

2. **Return objects directly** - `return { ok: true }` uses native JSON writer.

3. **Avoid Response for simple cases** - String/object returns skip Response overhead.

4. **Use cork for multiple sends** - `ws.cork(() => { ws.send(a); ws.send(b); })`

5. **Keep handlers synchronous when possible** - Async adds overhead.

6. **Use WebSocket pub/sub** - `ws.publish()` is optimized for broadcast.

## Comparison with Bun.serve

| Feature     | node:smol-http | Bun.serve    |
| ----------- | -------------- | ------------ |
| API         | Compatible     | Native       |
| Routes      | Trie-based     | Trie-based   |
| WebSocket   | Full support   | Full support |
| TLS         | Via smol-https | Built-in     |
| Performance | ~90% of Bun    | Baseline     |
| Platform    | Node.js        | Bun only     |

## See Also

- [node:smol-sql](./smol-sql-api.md) - SQL database API
- [node:smol-ilp](./smol-ilp-api.md) - InfluxDB Line Protocol client
- [node:smol-vfs](./smol-vfs-api.md) - Virtual filesystem for SEA apps
