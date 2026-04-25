# node-smol Built-in Modules Guide

This guide covers the nine built-in `node:smol-*` modules available in node-smol. These modules are designed for high performance and are not available in standard Node.js.

## Quick Overview

| Module               | Purpose            | When to Use                                |
| -------------------- | ------------------ | ------------------------------------------ |
| `node:smol-ffi`      | Foreign functions  | Calling native C libraries without addons  |
| `node:smol-http`     | HTTP servers       | Building web APIs and servers              |
| `node:smol-https`    | HTTPS servers      | Building TLS-enabled web servers           |
| `node:smol-ilp`      | Time-series data   | Sending metrics to QuestDB/InfluxDB        |
| `node:smol-manifest` | Manifest parsing   | Parsing package.json, lockfiles, etc.      |
| `node:smol-purl`     | Package URLs       | Parsing and building PURL strings          |
| `node:smol-sql`      | Database queries   | PostgreSQL and SQLite access               |
| `node:smol-versions` | Version management | Parsing, comparing, and matching versions  |
| `node:smol-vfs`      | Embedded files     | Accessing files bundled in your SEA binary |

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
| `clearCache()`                                         | Clear the JSON stringify cache             |
| `createCacheKey(method, url)`                          | Create a cache key for JSON data           |
| `createHttp2Server(options?)`                          | Create an HTTP/2 server with optimizations |
| `fastBinaryResponse(response, statusCode, buffer, contentType)` | Fast binary response using native bindings |
| `fastErrorResponse(response, statusCode, message)`     | Fast error response                        |
| `fastJsonResponse(response, statusCode, data, cacheKey?)` | Fast JSON response using native bindings   |
| `fastNotModified(res)`                                 | Fast 304 Not Modified response             |
| `fastPackumentResponse(response, packument, request)`  | Fast npm packument response                |
| `fastTarballResponse(res, data)`                       | Fast tarball response                      |
| `getCachedJson(obj, key)`                              | Get cached JSON string by key              |
| `getCacheStats()`                                      | Get cache hit/miss statistics              |
| `getContentLength(length)`                             | Get cached Content-Length header           |
| `getHeader(name, value)`                               | Get cached header string                   |
| `getHttp2Stats(session)`                               | Get HTTP/2 stream statistics               |
| `getStatusLine(code)`                                  | Get cached HTTP status line                |
| `getSubsetStats(original, subset)`                     | Get version subset size-reduction stats    |
| `invalidate(key)`                                      | Invalidate a cache entry                   |
| `optimizeHttp2Session(session)`                        | Apply optimizations to HTTP/2 session      |
| `request(url, options?)`                               | HTTP/1.1 client; returns `{status, headers, body, json()}` |
| `sendPackumentWithDeps(stream, packument, dependencies)` | Send packument with HTTP/2 push            |
| `sendWithPreloads(stream, headers, data, dependencies?)` | Send response with HTTP/2 push preloads    |
| `serve(options)`                                       | Create an HTTP server (main entry point)   |
| `setPipelining(depth, options?)`                       | Configure HTTP/1.1 pipelining depth on the built-in Agent |
| `stringifyWithCache(obj, cacheKey)`                    | Stringify JSON and cache the result        |
| `subsetPackument(packument, range)`                    | Create version subset of npm packument     |
| `withCork(response, callback)`                         | Execute function with corked socket        |
| `writeJsonResponse(response, statusCode, data)`        | Write JSON response to socket              |
| `writeNotFound(response, message?)`                    | Write 404 Not Found response               |
| `writeNotModified(res)`                                | Write 304 Not Modified response            |
| `writeTarballResponse(response, statusCode, buffer)`   | Write tarball response with headers        |

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
  port: 3000,           // Port to listen on (default: 3000; 0 = OS-assigned)
  hostname: '0.0.0.0',  // Hostname to bind to
  workers: 1,           // Number of worker processes (SO_REUSEPORT fan-out)
  fetch(request) { },   // Request handler (required)
})
```

`serve()` returns a minimal server instance:

| Property/Method | Description                                            |
| --------------- | ------------------------------------------------------ |
| `port`          | Port the server is listening on (readonly)             |
| `hostname`      | Hostname the server is bound to (readonly)             |
| `url`           | Full URL of the server (`URL` object, readonly)        |
| `stop()`        | Promise — closes server and all worker subprocesses    |
| `workers`       | Number of worker subprocesses (multi-worker mode only) |

Node-smol's HTTP server is intentionally minimal — no pub/sub, no WebSocket
upgrade handling, no hot reload, no per-request middleware. The C++ uWS
layer registers one fetch handler per port and drains requests through it.
For WebSocket or pub/sub, use `uWebSockets` directly from userspace.

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

| Class                | Description                                            |
| -------------------- | ------------------------------------------------------ |
| `SmolPgProvider`     | Lazy-loaded PostgreSQL-backed VFS storage provider     |
| `SmolSqliteProvider` | Lazy-loaded SQLite-backed VFS storage provider         |
| `VFSError`           | Error class for VFS operations                         |

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

## node:smol-ffi

A cross-platform Foreign Function Interface for calling native C libraries directly from JavaScript without compiling addons.

### Quick Start

```javascript
import ffi from 'node:smol-ffi'

// Open a native library and call a function.
const lib = ffi.open('libm.so.6')
const sqrt = lib.func('sqrt', 'f64', ['f64'])
console.log(sqrt(16)) // 4
lib.close()

// Or with batch definitions:
const { lib: mathLib, functions } = ffi.dlopen('libm.so.6', {
  sqrt: { result: 'f64', parameters: ['f64'] },
  ceil: { result: 'f64', parameters: ['f64'] },
})
console.log(functions.sqrt(25)) // 5
console.log(functions.ceil(4.2)) // 5
mathLib.close()
```

### Module Exports (Alphabetical)

#### Classes

| Class      | Description                        |
| ---------- | ---------------------------------- |
| `FFIError` | Error class for FFI operations     |
| `Library`  | Represents a loaded native library |

#### Functions

| Function                               | Description                                          |
| -------------------------------------- | ---------------------------------------------------- |
| `bufferToPtr(buffer)`                  | Get BigInt pointer from a Buffer/TypedArray          |
| `dlopen(path, definitions?)`           | Open library with batch function definitions         |
| `getFloat32(ptr, offset?)`             | Read float32 from memory                             |
| `getFloat64(ptr, offset?)`             | Read float64 from memory                             |
| `getInt8(ptr, offset?)`                | Read int8 from memory                                |
| `getInt16(ptr, offset?)`               | Read int16 from memory                               |
| `getInt32(ptr, offset?)`               | Read int32 from memory                               |
| `getInt64(ptr, offset?)`               | Read int64 from memory                               |
| `getUint8(ptr, offset?)`               | Read uint8 from memory                               |
| `getUint16(ptr, offset?)`              | Read uint16 from memory                              |
| `getUint32(ptr, offset?)`              | Read uint32 from memory                              |
| `getUint64(ptr, offset?)`              | Read uint64 from memory                              |
| `open(path)`                           | Open a native library, return Library instance       |
| `ptrToArrayBuffer(ptr, length, copy?)` | Create ArrayBuffer from pointer                      |
| `ptrToBuffer(ptr, length, copy?)`      | Create Buffer from pointer (zero-copy if copy=false) |
| `ptrToString(ptr)`                     | Read null-terminated C string from pointer           |
| `setFloat32(ptr, offset, value)`       | Write float32 to memory                              |
| `setFloat64(ptr, offset, value)`       | Write float64 to memory                              |
| `setInt8(ptr, offset, value)`          | Write int8 to memory                                 |
| `setInt16(ptr, offset, value)`         | Write int16 to memory                                |
| `setInt32(ptr, offset, value)`         | Write int32 to memory                                |
| `setInt64(ptr, offset, value)`         | Write int64 to memory                                |
| `setUint8(ptr, offset, value)`         | Write uint8 to memory                                |
| `setUint16(ptr, offset, value)`        | Write uint16 to memory                               |
| `setUint32(ptr, offset, value)`        | Write uint32 to memory                               |
| `setUint64(ptr, offset, value)`        | Write uint64 to memory                               |

#### Constants

| Constant | Description                                              |
| -------- | -------------------------------------------------------- |
| `suffix` | Platform shared-library suffix (`so`, `dylib`, `dll`)    |
| `types`  | Type name constants (VOID, BOOL, INT_32, FLOAT_64, etc.) |

### Library Class Methods (Alphabetical)

| Property/Method                                | Description                              |
| ---------------------------------------------- | ---------------------------------------- |
| `close()`                                      | Close the library and release resources  |
| `closed`                                       | Whether the library is closed (readonly) |
| `func(name, returnType, paramTypes?)`          | Bind a single function (positional form) |
| `func(name, { result, parameters })`           | Bind a single function (object form)     |
| `funcs(definitions)`                           | Batch bind multiple functions            |
| `id`                                           | Internal library handle (readonly)       |
| `registerCallback(returnType, paramTypes, fn)` | Register JS function as native callback  |
| `symbol(name)`                                 | Resolve raw symbol address (BigInt)      |
| `unregisterCallback(ptr)`                      | Unregister a callback by its pointer     |

### Supported FFI Types

| Type String | Aliases    | Description              |
| ----------- | ---------- | ------------------------ |
| `'void'`    |            | No return value          |
| `'bool'`    |            | Boolean                  |
| `'i8'`      |            | Signed 8-bit int         |
| `'u8'`      |            | Unsigned 8-bit int       |
| `'i16'`     |            | Signed 16-bit int        |
| `'u16'`     |            | Unsigned 16-bit int      |
| `'i32'`     | `'int'`    | Signed 32-bit int        |
| `'u32'`     | `'uint'`   | Unsigned 32-bit int      |
| `'i64'`     |            | Signed 64-bit int        |
| `'u64'`     |            | Unsigned 64-bit int      |
| `'f32'`     | `'float'`  | 32-bit float             |
| `'f64'`     | `'double'` | 64-bit float             |
| `'pointer'` | `'ptr'`    | Pointer (BigInt)         |
| `'string'`  | `'str'`    | Null-terminated C string |
| `'buffer'`  |            | Buffer/TypedArray        |

### Signature Formats

Functions support both positional and object signatures:

```javascript
// Positional: (returnType, [paramTypes])
const sqrt = lib.func('sqrt', 'f64', ['f64'])

// Object: ({ result, parameters })
const sqrt = lib.func('sqrt', { result: 'f64', parameters: ['f64'] })

// Object alternate keys: returns/return, arguments
const sqrt = lib.func('sqrt', { returns: 'f64', arguments: ['f64'] })
```

### Callback Example

```javascript
import ffi from 'node:smol-ffi'

const lib = ffi.open('libc.so.6')
const qsort = lib.func('qsort', 'void', ['pointer', 'u64', 'u64', 'pointer'])

// Register a JS comparator as a native callback.
const comparator = lib.registerCallback(
  'i32',
  ['pointer', 'pointer'],
  (a, b) => {
    return ffi.getInt32(a, 0) - ffi.getInt32(b, 0)
  },
)

// Use the callback pointer with qsort.
// qsort(array_ptr, count, element_size, comparator)
```

---

## node:smol-https

An HTTPS server module -- a thin TLS wrapper around `node:smol-http`. Follows the same pattern as Node.js's `http`/`https` module separation.

### Quick Start

```javascript
import { serve } from 'node:smol-https'
import { readFileSync } from 'node:fs'

const server = serve({
  port: 443,
  key: readFileSync('server.key'),
  cert: readFileSync('server.cert'),
  fetch(request) {
    return new Response('Hello, HTTPS!')
  },
})
```

### Module Exports

| Function         | Description                                   |
| ---------------- | --------------------------------------------- |
| `serve(options)` | Create an HTTPS server (requires TLS options) |

### serve() Options

All `node:smol-http` `serve()` options are supported, plus:

| Option       | Type            | Description                                         |
| ------------ | --------------- | --------------------------------------------------- |
| `key`        | Buffer / string | TLS private key                                     |
| `cert`       | Buffer / string | TLS certificate                                     |
| `ca`         | Buffer / string | TLS CA certificate(s)                               |
| `passphrase` | string          | Passphrase for private key                          |
| `tls`        | object          | TLS options object (any `tls.createServer` options) |
| `port`       | number          | Port (default: 443 for HTTPS)                       |

TLS options can be provided as top-level keys (`key`, `cert`, `ca`, `passphrase`) or via the `tls` object. Performance-oriented TLS defaults are applied automatically (session caching, modern cipher suites, X25519/P-256 ECDH).

For HTTP utilities (caching, fast responses, etc.), import from `node:smol-http` directly.

---

## node:smol-manifest

High-performance parser for package manifests and lockfiles. Supports package.json, package-lock.json, yarn.lock, pnpm-lock.yaml, and more.

### Quick Start

```javascript
import {
  detectFormat,
  getPackage,
  parse,
  parseLockfile,
} from 'node:smol-manifest'

// Auto-detect format from filename.
const result = parse('package.json', content)

// Parse a lockfile.
const lock = parseLockfile(content, 'npm')

// O(1) package lookup.
const pkg = getPackage(lock, 'lodash')
```

### Module Exports (Alphabetical)

#### Classes

| Class           | Description                         |
| --------------- | ----------------------------------- |
| `ManifestError` | Error class for manifest operations |

#### Functions

| Function                          | Description                               |
| --------------------------------- | ----------------------------------------- |
| `analyzeLockfile(lockfile)`                        | Analyze lockfile for statistics/issues       |
| `createStreamingParser(content, ecosystem)`        | Async iterator over packages in large files  |
| `detectFormat(filename)`                           | Auto-detect manifest/lockfile format         |
| `findPackages(lockfile, pattern)`                  | Search packages matching a pattern           |
| `getPackage(lockfile, name)`                       | O(1) package lookup by name                  |
| `parse(filename, content)`                         | Auto-detect format and parse                 |
| `parseLockfile(content, ecosystem, format?)`       | Parse a lockfile (format auto-detected)      |
| `parseManifest(content, ecosystem)`                | Parse a manifest by ecosystem                |

#### Constants

| Constant         | Description                             |
| ---------------- | --------------------------------------- |
| `supportedFiles` | List of supported filenames and formats |

---

## node:smol-purl

High-performance Package URL (PURL) parser and builder, per the [PURL spec](https://github.com/package-url/purl-spec).

### Quick Start

```javascript
import { parse, build } from 'node:smol-purl'

const purl = parse('pkg:npm/%40scope/name@1.0.0')
console.log(purl.type) // 'npm'
console.log(purl.namespace) // '@scope'
console.log(purl.name) // 'name'
console.log(purl.version) // '1.0.0'

const str = build({ type: 'npm', name: 'lodash', version: '4.17.21' })
console.log(str) // 'pkg:npm/lodash@4.17.21'
```

### Module Exports (Alphabetical)

#### Classes

| Class       | Description                     |
| ----------- | ------------------------------- |
| `PurlError` | Error class for PURL operations |

#### Functions

| Function            | Description                                           |
| ------------------- | ----------------------------------------------------- |
| `build(components)` | Build a PURL string from components                   |
| `cacheStats()`      | Get parse cache hit/miss statistics                   |
| `clearCache()`      | Clear the parse cache                                 |
| `equals(a, b)`      | Check if two PURLs are equivalent                     |
| `isValid(purl)`     | Check if a string is a valid PURL                     |
| `normalize(purl)`   | Normalize a PURL string                               |
| `parse(purl)`       | Parse a PURL string into components                   |
| `parseBatch(purls)` | Parse multiple PURLs at once                          |
| `tryParse(purl)`    | Parse without throwing (returns undefined on failure) |

#### Constants

| Constant | Description                                        |
| -------- | -------------------------------------------------- |
| `types`  | Known PURL type constants (npm, pypi, maven, etc.) |

---

## node:smol-versions

High-performance version parsing, comparison, and range matching with multi-ecosystem support (npm, Maven, PyPI, NuGet, Cargo, Go, and more).

### Quick Start

```javascript
import { parse, compare, satisfies } from 'node:smol-versions'

// Parse a version.
const v = parse('1.2.3-beta.1', 'npm')

// Compare versions.
compare('1.0.0', '2.0.0', 'npm') // -1
compare('2.0.0', '1.0.0', 'npm') // 1
compare('1.0.0', '1.0.0', 'npm') // 0

// Range matching.
satisfies('1.5.0', '^1.0.0', 'npm') // true
satisfies('2.0.0', '^1.0.0', 'npm') // false
```

### Module Exports (Alphabetical)

#### Classes

| Class          | Description                        |
| -------------- | ---------------------------------- |
| `VersionError` | Error class for version operations |

#### Functions

| Function                                     | Description                                           |
| -------------------------------------------- | ----------------------------------------------------- |
| `cacheStats()`                               | Get parse cache hit/miss statistics                   |
| `clearCache()`                               | Clear the parse cache                                 |
| `coerce(version, ecosystem?)`                | Coerce a string into a valid version                  |
| `compare(a, b, ecosystem?)`                  | Compare two versions (-1, 0, 1)                       |
| `eq(a, b, ecosystem?)`                       | Check if versions are equal                           |
| `filter(versions, range, ecosystem?)`        | Filter versions matching a range                      |
| `gt(a, b, ecosystem?)`                       | Check if a > b                                        |
| `gte(a, b, ecosystem?)`                      | Check if a >= b                                       |
| `inc(version, release, ecosystem?)`          | Increment version by release type                     |
| `lt(a, b, ecosystem?)`                       | Check if a < b                                        |
| `lte(a, b, ecosystem?)`                      | Check if a <= b                                       |
| `max(versions, ecosystem?)`                  | Find the maximum version                              |
| `maxSatisfying(versions, range, ecosystem?)` | Find the max version matching a range                 |
| `min(versions, ecosystem?)`                  | Find the minimum version                              |
| `minSatisfying(versions, range, ecosystem?)` | Find the min version matching a range                 |
| `neq(a, b, ecosystem?)`                      | Check if versions are not equal                       |
| `parse(version, ecosystem?)`                 | Parse a version string                                |
| `rsort(versions, ecosystem?)`                | Sort versions in descending order                     |
| `satisfies(version, range, ecosystem?)`      | Check if version matches a range                      |
| `sort(versions, ecosystem?)`                 | Sort versions in ascending order                      |
| `tryParse(version, ecosystem?)`              | Parse without throwing (returns undefined on failure) |
| `valid(version, ecosystem?)`                 | Check if a string is a valid version                  |

#### Constants

| Constant     | Description                                            |
| ------------ | ------------------------------------------------------ |
| `ecosystems` | Supported ecosystem constants (npm, maven, pypi, etc.) |

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

| Feature          | Standard Node.js                       | node-smol                             |
| ---------------- | -------------------------------------- | ------------------------------------- |
| HTTP server      | `http.createServer()`                  | `serve()` with Bun-compatible API     |
| HTTPS server     | `https.createServer()`                 | `serve()` with optimized TLS defaults |
| Database         | External packages (pg, better-sqlite3) | Built-in `node:smol-sql`              |
| Time-series      | External packages                      | Built-in `node:smol-ilp`              |
| FFI              | External packages (ffi-napi, koffi)    | Built-in `node:smol-ffi`              |
| Embedded files   | Custom solutions                       | Built-in `node:smol-vfs`              |
| Package URLs     | External packages (packageurl-js)      | Built-in `node:smol-purl`             |
| Manifest parsing | External packages per format           | Built-in `node:smol-manifest`         |
| Version matching | External packages (semver)             | Built-in `node:smol-versions`         |

## Further Reading

- [Bun.serve documentation](https://bun.sh/docs/api/http) - Our HTTP API is compatible
- [InfluxDB Line Protocol](https://docs.influxdata.com/influxdb/v2/reference/syntax/line-protocol/) - Protocol used by smol-ilp
- [Node.js SEA documentation](https://nodejs.org/api/single-executable-applications.html) - Background on Single Executable Apps
