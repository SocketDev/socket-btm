# node-smol Built-in Modules Guide

This guide covers the four built-in `node:smol-*` modules available in node-smol. These modules are designed for high performance and are not available in standard Node.js.

## Quick Overview

| Module           | Purpose          | When to Use                                |
| ---------------- | ---------------- | ------------------------------------------ |
| `node:smol-http` | HTTP servers     | Building web APIs and servers              |
| `node:smol-ilp`  | Time-series data | Sending metrics to QuestDB/InfluxDB        |
| `node:smol-sql`  | Database queries | PostgreSQL and SQLite access               |
| `node:smol-vfs`  | Embedded files   | Accessing files bundled in your SEA binary |

---

## node:smol-http

A high-performance HTTP server with an API compatible with [Bun.serve](https://bun.sh/docs/api/http).

### Quick Start

```javascript
import { serve } from 'node:smol-http'

const server = serve({
  port: 3000,
  fetch(request) {
    return new Response('Hello World!')
  },
})
```

### Module Exports (Alphabetical)

#### Classes

| Class              | Description                                    |
| ------------------ | ---------------------------------------------- |
| `AuthCache`        | Authentication token cache with TTL support    |
| `CompressionCache` | Cache for compressed response data             |
| `CorkManager`      | Manager for TCP socket corking to batch writes |
| `DependencyGraph`  | Package dependency resolution graph            |
| `ETagCache`        | HTTP ETag cache for conditional responses      |

#### Functions

| Function                                              | Description                                |
| ----------------------------------------------------- | ------------------------------------------ |
| `clearCache()`                                        | Clear the JSON stringify cache             |
| `createCacheKey(data)`                                | Create a cache key for JSON data           |
| `createHttp2Server(handler)`                          | Create an HTTP/2 server with optimizations |
| `fastBinaryResponse(res, data, contentType, status?)` | Fast binary response using native bindings |
| `fastErrorResponse(res, status, message)`             | Fast error response                        |
| `fastJsonResponse(res, data, status?)`                | Fast JSON response using native bindings   |
| `fastNotModified(res)`                                | Fast 304 Not Modified response             |
| `fastPackumentResponse(res, packument)`               | Fast npm packument response                |
| `fastTarballResponse(res, data)`                      | Fast tarball response                      |
| `getCachedJson(key)`                                  | Get cached JSON string by key              |
| `getCacheStats()`                                     | Get cache hit/miss statistics              |
| `getContentLength(length)`                            | Get cached Content-Length header           |
| `getHeader(name, value)`                              | Get cached header string                   |
| `getHttp2Stats()`                                     | Get HTTP/2 stream statistics               |
| `getStatusLine(code)`                                 | Get cached HTTP status line                |
| `getSubsetStats()`                                    | Get version subset statistics              |
| `invalidate(key)`                                     | Invalidate a cache entry                   |
| `optimizeHttp2Session(session)`                       | Apply optimizations to HTTP/2 session      |
| `sendPackumentWithDeps(res, packument, deps)`         | Send packument with HTTP/2 push            |
| `sendWithPreloads(res, data, preloads)`               | Send response with HTTP/2 push preloads    |
| `serve(options)`                                      | Create an HTTP server (main entry point)   |
| `stringifyWithCache(key, data)`                       | Stringify JSON and cache the result        |
| `subsetPackument(packument, range)`                   | Create version subset of npm packument     |
| `withCork(socket, fn)`                                | Execute function with corked socket        |
| `writeJsonResponse(res, data, status?)`               | Write JSON response to socket              |
| `writeNotFound(res)`                                  | Write 404 Not Found response               |
| `writeNotModified(res)`                               | Write 304 Not Modified response            |
| `writeTarballResponse(res, data, filename)`           | Write tarball response with headers        |

#### Global Instances

| Instance           | Description                                     |
| ------------------ | ----------------------------------------------- |
| `authCache`        | Global authentication cache                     |
| `compressionCache` | Global compression cache                        |
| `dependencyGraph`  | Global dependency graph                         |
| `etagCache`        | Global ETag cache                               |
| `semver`           | SemVer utilities (`satisfies`, `maxSatisfying`) |

### serve() Options

```javascript
serve({
  // Network options
  port: 3000, // Port to listen on (default: 3000, 0 for random)
  hostname: '0.0.0.0', // Hostname to bind to
  unix: '/tmp/app.sock', // Unix socket path (overrides port/hostname)

  // Server options
  development: true, // Development mode (default: NODE_ENV !== 'production')
  idleTimeout: 10, // Connection idle timeout in seconds
  maxBodySize: 10485760, // Max request body size (default: 10MB)

  // Handlers
  fetch(request, server) {
    /* ... */
  }, // Request handler (required)
  routes: {
    /* ... */
  }, // Route handlers
  websocket: {
    /* ... */
  }, // WebSocket handlers
  error(err) {
    /* ... */
  }, // Error handler
})
```

### Server Instance Methods (Alphabetical)

| Property/Method                   | Description                                      |
| --------------------------------- | ------------------------------------------------ |
| `development`                     | Whether server is in development mode (readonly) |
| `hostname`                        | Hostname server is bound to (readonly)           |
| `pendingRequests`                 | Number of active HTTP requests (readonly)        |
| `pendingWebSockets`               | Number of WebSocket connections (readonly)       |
| `port`                            | Port server is listening on (readonly)           |
| `publish(topic, data, compress?)` | Publish to all topic subscribers                 |
| `reload(options)`                 | Hot reload server with new options               |
| `requestIP(request)`              | Get client IP info for a request                 |
| `stop(closeActive?)`              | Stop the server                                  |
| `subscriberCount(topic)`          | Get subscriber count for a topic                 |
| `upgrade(request, data?)`         | Upgrade HTTP request to WebSocket                |
| `url`                             | Full URL of the server (readonly)                |

### Request Object Properties (Alphabetical)

| Property/Method | Description                              |
| --------------- | ---------------------------------------- |
| `arrayBuffer()` | Get body as ArrayBuffer                  |
| `body`          | Request body as string                   |
| `headers`       | Request headers (Headers-like interface) |
| `json()`        | Parse body as JSON                       |
| `method`        | HTTP method (GET, POST, etc.)            |
| `params`        | Route parameters from pattern matching   |
| `pathname`      | URL pathname (e.g., '/api/users')        |
| `query`         | Parsed query parameters                  |
| `text()`        | Get body as text                         |
| `url`           | Full URL including protocol and host     |

### Request Headers Methods (Alphabetical)

| Method              | Description                     |
| ------------------- | ------------------------------- |
| `entries()`         | Iterator of [name, value] pairs |
| `forEach(callback)` | Call function for each header   |
| `get(name)`         | Get header value by name        |
| `has(name)`         | Check if header exists          |
| `keys()`            | Iterator of header names        |
| `values()`          | Iterator of header values       |

### WebSocket Instance Methods (Alphabetical)

| Property/Method                         | Description                           |
| --------------------------------------- | ------------------------------------- |
| `close(code?, reason?)`                 | Close connection gracefully           |
| `cork(callback)`                        | Cork writes for batching              |
| `data`                                  | User-attached data                    |
| `isSubscribed(topic)`                   | Check if subscribed to topic          |
| `ping(data?)`                           | Send ping frame                       |
| `pong(data?)`                           | Send pong frame                       |
| `publish(topic, data, compress?)`       | Publish to topic (excludes self)      |
| `publishBinary(topic, data, compress?)` | Publish binary to topic               |
| `publishText(topic, text, compress?)`   | Publish text to topic                 |
| `readyState`                            | Connection state (0-3) (readonly)     |
| `remoteAddress`                         | Remote IP address (readonly)          |
| `send(data, compress?)`                 | Send data (auto-detects type)         |
| `sendBinary(data, compress?)`           | Send binary message                   |
| `sendText(text, compress?)`             | Send text message                     |
| `subscribe(topic)`                      | Subscribe to a pub/sub topic          |
| `subscriptions`                         | Array of subscribed topics (readonly) |
| `terminate()`                           | Immediately terminate connection      |
| `unsubscribe(topic)`                    | Unsubscribe from topic                |

### WebSocket Event Handlers (Alphabetical)

```javascript
websocket: {
  close(ws, code, reason) { },   // Connection closed
  drain(ws) { },                  // Ready for more data
  error(ws, error) { },           // Error occurred
  message(ws, message) { },       // Message received
  open(ws) { },                   // Connection opened
  ping(ws, data) { },             // Ping frame received
  pong(ws, data) { },             // Pong frame received
}
```

### Routes API

```javascript
routes: {
  '/': handler,                    // Static route
  '/users/:id': handler,           // Route parameter
  '/files/*': handler,             // Wildcard (params['*'])
  '/api/posts': {                  // Per-method handlers
    DELETE: handler,
    GET: handler,
    HEAD: handler,
    OPTIONS: handler,
    PATCH: handler,
    POST: handler,
    PUT: handler,
    '*': handler,                  // Catch-all method
  }
}
```

---

## node:smol-ilp

Send time-series metrics to QuestDB, InfluxDB, and compatible databases.

### Quick Start

```javascript
import { Sender } from 'node:smol-ilp'

const sender = new Sender({ host: 'localhost', port: 9009 })
await sender.connect()

sender
  .table('metrics')
  .symbol('host', 'server-1')
  .floatColumn('cpu', 45.2)
  .atNow()

await sender.flush()
await sender.close()
```

### Module Exports (Alphabetical)

#### Classes

| Class            | Description                          |
| ---------------- | ------------------------------------ |
| `BulkRowBuilder` | Batch row builder with auto-flushing |
| `ILPError`       | Error class for ILP operations       |
| `Sender`         | Main ILP sender class                |

#### Constants

| Constant     | Description                                        |
| ------------ | -------------------------------------------------- |
| `ErrorCodes` | Error code constants (CLOSED, NOT_CONNECTED, etc.) |
| `TimeUnit`   | Timestamp unit constants and utilities             |

### Sender Constructor Options (Alphabetical)

```javascript
new Sender({
  autoFlush: false, // Enable auto-flush
  autoFlushInterval: 0, // Flush interval in ms (0 = disabled)
  autoFlushRows: 1000, // Flush after this many rows
  bufferSize: 65536, // Initial buffer size
  connectTimeout: 10000, // Connection timeout in ms
  host: 'localhost', // Host to connect to
  maxBufferSize: 104857600, // Maximum buffer size (100MB)
  port: 9009, // Port to connect to
  sendTimeout: 30000, // Send timeout in ms
})
```

### Sender Instance Methods (Alphabetical)

| Property/Method                       | Description                                  |
| ------------------------------------- | -------------------------------------------- |
| `at(timestamp, unit?)`                | Finalize row with explicit timestamp         |
| `atNow()`                             | Finalize row with current timestamp          |
| `bool(name, value)`                   | Add boolean column (alias for `boolColumn`)  |
| `boolColumn(name, value)`             | Add boolean column                           |
| `bufferAvailable`                     | Available buffer space in bytes (readonly)   |
| `bufferUsed`                          | Used buffer space in bytes (readonly)        |
| `clear()`                             | Clear buffer without sending                 |
| `close()`                             | Close sender and release resources           |
| `closed`                              | Whether sender is closed (readonly)          |
| `connect()`                           | Connect to ILP server                        |
| `connected`                           | Whether sender is connected (readonly)       |
| `field(name, value)`                  | Smart field (auto-detects type)              |
| `float(name, value)`                  | Add float column (alias for `floatColumn`)   |
| `floatColumn(name, value)`            | Add float column                             |
| `flush()`                             | Flush buffered data to server                |
| `insertRow(table, data)`              | Insert complete row in one call              |
| `insertRows(table, rows)`             | Insert multiple rows in one call             |
| `int(name, value)`                    | Add integer column (alias for `intColumn`)   |
| `intColumn(name, value)`              | Add integer column                           |
| `isBufferCritical()`                  | Check if buffer >= 90% full                  |
| `isBufferPressured()`                 | Check if buffer >= 75% full                  |
| `stats`                               | Sender statistics (readonly)                 |
| `str(name, value)`                    | Add string column (alias for `stringColumn`) |
| `stringColumn(name, value)`           | Add string column                            |
| `symbol(name, value)`                 | Add symbol (tag) column                      |
| `table(name)`                         | Start new row with table name                |
| `tag(name, value)`                    | Add tag column (alias for `symbol`)          |
| `timestampColumn(name, value, unit?)` | Add timestamp column                         |

### Sender Static Methods (Alphabetical)

| Method                                  | Description                          |
| --------------------------------------- | ------------------------------------ |
| `Sender.fromConnectionString(str)`      | Create sender from connection string |
| `Sender.sendOnce(options, table, rows)` | Fire-and-forget send                 |

### Sender Events (Alphabetical)

| Event            | Description                            |
| ---------------- | -------------------------------------- |
| `bufferCritical` | Buffer >= 90% full (flush immediately) |
| `bufferPressure` | Buffer >= 75% full (consider flushing) |
| `connect`        | Connection established                 |
| `disconnect`     | Connection closed                      |
| `error`          | Error occurred                         |
| `flush`          | Data flushed successfully              |
| `warning`        | Non-fatal warning                      |

### BulkRowBuilder Methods (Alphabetical)

| Property/Method | Description                    |
| --------------- | ------------------------------ |
| `add(data)`     | Add a row to the batch         |
| `addMany(rows)` | Add multiple rows to the batch |
| `finish()`      | Flush all remaining rows       |
| `stats`         | Current stats (readonly)       |

### TimeUnit Constants and Methods (Alphabetical)

| Property/Method                     | Description               |
| ----------------------------------- | ------------------------- |
| `TimeUnit.convert(value, from, to)` | Convert between units     |
| `TimeUnit.fromDate(date, unit?)`    | Convert Date to timestamp |
| `TimeUnit.Microseconds`             | Microseconds constant (1) |
| `TimeUnit.Milliseconds`             | Milliseconds constant (2) |
| `TimeUnit.Nanoseconds`              | Nanoseconds constant (0)  |
| `TimeUnit.now(unit?)`               | Get current timestamp     |
| `TimeUnit.Seconds`                  | Seconds constant (3)      |

---

## node:smol-sql

A unified SQL interface for PostgreSQL and SQLite with tagged template literals.

### Quick Start

```javascript
import { sql, SQL } from 'node:smol-sql'

// Using environment variable (POSTGRES_URL or DATABASE_URL)
const users = await sql`SELECT * FROM users WHERE id = ${1}`

// Explicit connection
const db = new SQL('postgres://user:pass@localhost:5432/mydb')
const lite = new SQL(':memory:') // SQLite in-memory
```

### Module Exports (Alphabetical)

#### Classes

| Class                           | Description                       |
| ------------------------------- | --------------------------------- |
| `PostgresError`                 | PostgreSQL-specific error         |
| `ReservedConnection`            | Reserved connection from pool     |
| `Savepoint`                     | Transaction savepoint             |
| `SQL`                           | Main SQL client class             |
| `SQLConnectionClosedError`      | Connection closed error           |
| `SQLError`                      | Base SQL error class              |
| `SQLFragment`                   | Safe SQL fragment for identifiers |
| `SQLiteError`                   | SQLite-specific error             |
| `SQLQuery`                      | Pending SQL query (Promise-like)  |
| `SQLTransactionCommittedError`  | Transaction already committed     |
| `SQLTransactionRolledBackError` | Transaction already rolled back   |
| `Transaction`                   | Transaction context               |

#### Constants

| Constant             | Description                           |
| -------------------- | ------------------------------------- |
| `IsolationLevel`     | Transaction isolation level constants |
| `PG_ERROR_CODES`     | PostgreSQL error code constants       |
| `SQLITE_ERROR_CODES` | SQLite error code constants           |

#### Functions

| Function                     | Description                                  |
| ---------------------------- | -------------------------------------------- |
| `isCheckViolation(err)`      | Check if error is check constraint violation |
| `isConnectionError(err)`     | Check if error is connection error           |
| `isForeignKeyViolation(err)` | Check if error is foreign key violation      |
| `isNotNullViolation(err)`    | Check if error is not null violation         |
| `isSyntaxError(err)`         | Check if error is syntax error               |
| `isUndefinedTable(err)`      | Check if table doesn't exist                 |
| `isUniqueViolation(err)`     | Check if error is unique violation           |

#### Instances

| Instance | Description                         |
| -------- | ----------------------------------- |
| `sql`    | Default SQL instance using env vars |

### SQL Class Methods (Alphabetical)

| Method                                      | Description                        |
| ------------------------------------------- | ---------------------------------- |
| `begin(fn)`                                 | Begin a transaction                |
| `begin(options, fn)`                        | Begin transaction with options     |
| `close(options?)`                           | Close all connections              |
| `deleteMany(table, ids, idColumn?)`         | Delete multiple rows by ID         |
| `file(path, params?)`                       | Execute SQL from file              |
| `findById(table, id, idColumn?)`            | Find row by primary key            |
| `insertMany(table, rows, options?)`         | Insert multiple rows               |
| `reserve()`                                 | Reserve exclusive connection       |
| `unsafe(query, params?)`                    | Execute raw SQL (use with caution) |
| `updateMany(table, ids, values, idColumn?)` | Update multiple rows by ID         |
| `upsert(table, row, options)`               | Insert or update a row             |
| `upsertMany(table, rows, options)`          | Insert or update multiple rows     |

### SQL Static Methods (Alphabetical)

| Method                 | Description                     |
| ---------------------- | ------------------------------- |
| `SQL.array(values)`    | Create PostgreSQL array literal |
| `SQL.identifier(name)` | Create safe identifier fragment |
| `SQL.json(value)`      | Create JSON value               |

### SQLQuery Methods (Alphabetical)

| Method                          | Description                      |
| ------------------------------- | -------------------------------- |
| `cancel()`                      | Cancel a running query           |
| `count()`                       | Execute COUNT and return number  |
| `cursor(batchSize?)`            | Batch cursor for large results   |
| `execute()`                     | Start query execution            |
| `exists()`                      | Check if any rows exist          |
| `first()`                       | Return first row only            |
| `getQuery()`                    | Get query info without executing |
| `last()`                        | Return last row only             |
| `raw()`                         | Return rows as raw Buffer arrays |
| `stream()`                      | Stream rows one at a time        |
| `take(n)`                       | Return first n rows              |
| `then(onFulfilled, onRejected)` | Promise interface                |
| `values()`                      | Return rows as value arrays      |

### Transaction Methods (Alphabetical)

| Method                 | Description              |
| ---------------------- | ------------------------ |
| `begin()`              | Begin the transaction    |
| `commit()`             | Commit the transaction   |
| `rollback()`           | Rollback the transaction |
| `savepoint(name?, fn)` | Create a savepoint       |

### Savepoint Methods (Alphabetical)

| Method       | Description                |
| ------------ | -------------------------- |
| `create()`   | Create the savepoint       |
| `release()`  | Release (commit) savepoint |
| `rollback()` | Rollback to savepoint      |

### ReservedConnection Methods (Alphabetical)

| Method      | Description                     |
| ----------- | ------------------------------- |
| `release()` | Release connection back to pool |

### IsolationLevel Constants (Alphabetical)

| Constant                          | Value              |
| --------------------------------- | ------------------ |
| `IsolationLevel.READ_COMMITTED`   | 'read committed'   |
| `IsolationLevel.READ_UNCOMMITTED` | 'read uncommitted' |
| `IsolationLevel.REPEATABLE_READ`  | 'repeatable read'  |
| `IsolationLevel.SERIALIZABLE`     | 'serializable'     |

---

## node:smol-vfs

Read-only embedded filesystem for Single Executable Applications (SEA).

### Quick Start

```javascript
import vfs from 'node:smol-vfs'

if (vfs.hasVFS()) {
  const config = vfs.readFileSync('/snapshot/config.json', 'utf8')
  const files = vfs.listFiles({ extension: '.json' })
}
```

### Module Exports (Alphabetical)

#### Classes

| Class      | Description                    |
| ---------- | ------------------------------ |
| `VFSError` | Error class for VFS operations |

#### Constants

| Constant            | Description                    |
| ------------------- | ------------------------------ |
| `MAX_SYMLINK_DEPTH` | Maximum symlink recursion (32) |
| `MODE_COMPAT`       | Compatibility mode constant    |
| `MODE_IN_MEMORY`    | In-memory extraction mode      |
| `MODE_ON_DISK`      | On-disk extraction mode        |

#### Functions (Alphabetical)

| Function                                         | Description                                 |
| ------------------------------------------------ | ------------------------------------------- |
| `accessSync(path, mode?)`                        | Check file accessibility                    |
| `canBuildSea()`                                  | Check if LIEF support is available          |
| `closeSync(fd)`                                  | Close a file descriptor                     |
| `config()`                                       | Get VFS configuration                       |
| `createReadStream(path, options?)`               | Create readable stream from VFS file        |
| `existsSync(path)`                               | Check if file exists in VFS                 |
| `fstatSync(fd, options?)`                        | Get stats for open file descriptor          |
| `getCacheStats()`                                | Get extraction cache statistics             |
| `getRealPath(fd)`                                | Get real path for VFS file descriptor       |
| `getVFSStats()`                                  | Get comprehensive VFS stats                 |
| `getVfsPath(fd)`                                 | Get VFS path for file descriptor            |
| `handleNativeAddon(path)`                        | Extract and return path to native addon     |
| `hasVFS()`                                       | Check if running as SEA with VFS            |
| `isNativeAddon(path)`                            | Check if path is a .node file               |
| `isVfsFd(fd)`                                    | Check if FD was opened via VFS              |
| `isVFSPath(path)`                                | Check if path is a VFS path                 |
| `listFiles(options?)`                            | List all files in VFS                       |
| `lstatSync(path, options?)`                      | Get file stats without following symlinks   |
| `mount(vfsPath, options?)`                       | Extract VFS file to real filesystem (async) |
| `mountSync(vfsPath, options?)`                   | Extract VFS file to real filesystem (sync)  |
| `openSync(path, flags?, mode?)`                  | Open VFS file, return real FD               |
| `prefix()`                                       | Get VFS mount prefix (e.g., '/snapshot')    |
| `readdirSync(path, options?)`                    | Read directory contents                     |
| `readFileAsBuffer(path)`                         | Read file as Buffer                         |
| `readFileAsJSON(path)`                           | Read and parse file as JSON                 |
| `readFileAsText(path, encoding?)`                | Read file as text string                    |
| `readFileSync(path, options?)`                   | Read file from VFS                          |
| `readlinkSync(path, options?)`                   | Read symlink target                         |
| `readMultiple(paths, options?)`                  | Read multiple files at once                 |
| `readSync(fd, buffer, offset, length, position)` | Read from file descriptor                   |
| `realpathSync(path, options?)`                   | Resolve symlinks, get real path             |
| `size()`                                         | Get total number of VFS entries             |
| `statSync(path, options?)`                       | Get file stats                              |

### promises Namespace (Alphabetical)

| Function                                   | Description                          |
| ------------------------------------------ | ------------------------------------ |
| `promises.access(path, mode?)`             | Check file accessibility             |
| `promises.exists(path)`                    | Check if file exists                 |
| `promises.fstat(fd, options?)`             | Get stats for file descriptor        |
| `promises.lstat(path, options?)`           | Get stats without following symlinks |
| `promises.open(path, flags?, mode?)`       | Open file, return FD                 |
| `promises.readdir(path, options?)`         | Read directory contents              |
| `promises.readFile(path, options?)`        | Read file contents                   |
| `promises.readFileAsBuffer(path)`          | Read file as Buffer                  |
| `promises.readFileAsJSON(path)`            | Read and parse as JSON               |
| `promises.readFileAsText(path, encoding?)` | Read as text string                  |
| `promises.readlink(path, options?)`        | Read symlink target                  |
| `promises.readMultiple(paths, options?)`   | Read multiple files                  |
| `promises.realpath(path, options?)`        | Resolve symlinks                     |
| `promises.stat(path, options?)`            | Get file stats                       |

---

## Common Patterns

### Environment-Based Configuration

```javascript
import { SQL } from 'node:smol-sql'

const dbUrl =
  process.env.NODE_ENV === 'production'
    ? process.env.DATABASE_URL
    : 'sqlite://:memory:'

const db = new SQL(dbUrl)
```

### Graceful Shutdown

```javascript
import { serve } from 'node:smol-http'
import { Sender } from 'node:smol-ilp'

const server = serve({ port: 3000, fetch: () => new Response('OK') })
const metrics = new Sender({ host: 'localhost', port: 9009 })
await metrics.connect()

process.on('SIGTERM', async () => {
  await server.stop()
  await metrics.close()
  process.exit(0)
})
```

### Health Check Endpoint

```javascript
import { serve } from 'node:smol-http'
import { SQL } from 'node:smol-sql'

const db = new SQL(process.env.DATABASE_URL)

const server = serve({
  port: 3000,
  routes: {
    '/health': async () => {
      try {
        await db`SELECT 1`
        return Response.json({ status: 'healthy' })
      } catch {
        return Response.json({ status: 'unhealthy' }, { status: 503 })
      }
    },
  },
  fetch: () => new Response('Not Found', { status: 404 }),
})
```

---

## Differences from Standard Node.js

| Feature        | Standard Node.js                       | node-smol                         |
| -------------- | -------------------------------------- | --------------------------------- |
| HTTP server    | `http.createServer()`                  | `serve()` with Bun-compatible API |
| Database       | External packages (pg, better-sqlite3) | Built-in `node:smol-sql`          |
| Time-series    | External packages                      | Built-in `node:smol-ilp`          |
| Embedded files | Custom solutions                       | Built-in `node:smol-vfs`          |

## Further Reading

- [Bun.serve documentation](https://bun.sh/docs/api/http) - Our HTTP API is compatible
- [InfluxDB Line Protocol](https://docs.influxdata.com/influxdb/v2/reference/syntax/line-protocol/) - Protocol used by smol-ilp
- [Node.js SEA documentation](https://nodejs.org/api/single-executable-applications.html) - Background on Single Executable Apps
