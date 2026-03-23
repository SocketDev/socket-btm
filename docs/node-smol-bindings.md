# Native Performance Modules

Node-smol includes native C++ modules for high-performance database and network operations.
These modules provide zero-copy I/O and kernel-level optimizations where available.

## PostgreSQL Bindings (`socketsecurity/postgres/`)

Native libpq bindings with connection pooling and prepared statement caching.

### Features

- Connection pool with configurable min/max connections
- Prepared statement caching per connection
- Automatic connection health checks and reconnection
- Binary protocol support for type-safe parameter passing

### API

```javascript
const binding = process.binding('postgres');

// Create pool.
const poolId = binding.createPool({
  connectionString: 'postgresql://user:pass@localhost/db',
  minConnections: 2,
  maxConnections: 10,
  connectTimeoutMs: 10000
});

// Execute query.
const result = binding.executeSync(poolId, 'SELECT * FROM users');
// result: { status: 'PGRES_TUPLES_OK', rows: [...], rowCount: N }

// Parameterized query (SQL injection safe).
const result2 = binding.executeParamsSync(poolId,
  'SELECT * FROM users WHERE id = $1',
  [userId]
);

// Prepared statements for repeated queries.
binding.prepareSync(poolId, 'get_user', 'SELECT * FROM users WHERE id = $1');
const user = binding.executePreparedSync(poolId, 'get_user', [userId]);

// Pool stats.
const stats = binding.getPoolStats(poolId);
// stats: { idle: N, active: N, total: N, healthy: boolean }

// Cleanup.
binding.destroyPool(poolId);
```

### Build Requirements

- libpq development headers (`libpq-dev` on Debian/Ubuntu, `postgresql` on Homebrew)

---

## ILP Client (`socketsecurity/ilp/`)

Native InfluxDB Line Protocol client for high-throughput time-series ingestion.
Uses io_uring on Linux for zero-copy async I/O, with standard socket fallback.

### Features

- High-performance ILP line encoding with minimal allocations
- io_uring acceleration on Linux 5.1+ (automatic fallback to standard sockets)
- Efficient buffer management with configurable size limits
- TCP_NODELAY for low-latency writes

### API

```javascript
const binding = process.binding('ilp');

// Create sender.
const senderId = binding.createSender({
  host: 'questdb',
  port: 9009,
  connectTimeoutMs: 10000,
  useIoUring: true  // Auto-fallback if unavailable
});

// Connect.
binding.connect(senderId);

// Build and send rows.
binding.table(senderId, 'events');
binding.symbol(senderId, 'event_type', 'user.login');
binding.stringColumn(senderId, 'user_id', 'abc123');
binding.intColumn(senderId, 'response_time', 42);
binding.timestampColumn(senderId, 'occurred_at', Date.now() * 1000, 'us');
binding.at(senderId, Date.now() * 1000000, 'ns');

// Flush to server.
binding.flush(senderId);

// Stats.
const stats = binding.getStats(senderId);
// stats: { rowsBuffered, rowsSent, bytesSent, bufferSize, connected, ioUringAvailable }

// Cleanup.
binding.close(senderId);
binding.destroySender(senderId);
```

### Timestamp Units

- `'ns'` / `'nano'` - Nanoseconds (default for `at()`)
- `'us'` / `'micro'` - Microseconds (default for `timestampColumn()`)
- `'ms'` / `'milli'` - Milliseconds
- `'s'` / `'sec'` - Seconds

### Build Requirements

- Linux: liburing development headers (`liburing-dev`) for io_uring support
- All platforms: Standard POSIX sockets as fallback

---

## HTTP Performance (`socketsecurity/http-perf/`)

Native HTTP response acceleration for high-throughput web servers.

### Features

- HTTP header pooling to avoid allocations
- Fast 304 Not-Modified responses
- Zero-copy response buffers
- Response templates for common patterns
- TCP optimizations (cork/uncork, sendfile hints)
- io_uring network I/O on Linux
- mimalloc integration for faster allocations

### Build Requirements

- Linux: liburing for io_uring network acceleration
- All platforms: Uses platform-native TCP optimizations

---

## WebStreams Acceleration (`socketsecurity/webstreams/`)

Native stream chunk pooling and fast readable stream implementation.

### Features

- Stream chunk object pooling
- Synchronous fast-path for buffered reads
- Reduced GC pressure for high-throughput streaming

---

## Performance Guidelines

1. **Use prepared statements** for repeated PostgreSQL queries
2. **Batch ILP rows** before flushing to reduce syscall overhead
3. **Prefer io_uring** on Linux 5.1+ for maximum throughput
4. **Monitor pool stats** to tune connection limits
5. **Use binary protocol** for type-safe PostgreSQL parameters
