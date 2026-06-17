'use strict'

// PostgreSQL Adapter
// High-performance PostgreSQL client using libpq native bindings.

const {
  ArrayPrototypeJoin,
  ArrayPrototypePush,
  MathCeil,
  NumberIsInteger,
  NumberParseInt,
  Promise: PromiseCtor,
  SafeMap,
  StringPrototypeReplaceAll,
  StringPrototypeSlice,
  Symbol: SymbolCtor,
  URL,
} = primordials

// libpq connection-string grammar (per PostgreSQL docs §33.1.1): keywords
// are space-separated `keyword=value` pairs; values containing whitespace,
// single quotes, or backslashes MUST be single-quoted and backslash-
// escaped. Without quoting, a password like `s sslmode=disable` would
// silently downgrade TLS because libpq's tokenizer splits on whitespace.
function quoteConnValue(v) {
  const escaped = StringPrototypeReplaceAll(
    StringPrototypeReplaceAll(String(v), '\\', '\\\\'),
    "'",
    "\\'",
  )
  return `'${escaped}'`
}

// Maximum number of cached prepared statements per connection.
const PREPARED_STMT_CACHE_MAX_SIZE = 500

const { kEmptyObject } = require('internal/util')
const { PostgresError } = require('internal/socketsecurity/sql/errors')
const { hashQuery } = require('internal/socketsecurity/sql/query')
const { rowsToObjects } = require('internal/socketsecurity/sql/result')
const { lruGet, lruSet } = require('internal/socketsecurity/sql/cache')

// Native binding - loaded lazily.
let binding

function getBinding() {
  binding ??= internalBinding('smol_postgres')
  return binding
}

// Symbols for internal state.
const kPoolId = SymbolCtor('kPoolId')
const kConfig = SymbolCtor('kConfig')
const kPreparedStatements = SymbolCtor('kPreparedStatements')
const kClosed = SymbolCtor('kClosed')
const kPoolPromise = SymbolCtor('kPoolPromise')

/**
 * Parse a PostgreSQL connection URL.
 * Format: postgres://user:pass@host:port/database?params
 *
 * @param {string} url
 * @returns {object}
 */
function parseConnectionUrl(url) {
  // Use URL parser for robust parsing.
  const parsed = new URL(url)

  const port = parsed.port ? NumberParseInt(parsed.port, 10) : 5432
  return {
    __proto__: null,
    hostname: parsed.hostname || 'localhost',
    port: NumberIsInteger(port) ? port : 5432,
    database: StringPrototypeSlice(parsed.pathname, 1) || 'postgres',
    username: parsed.username || 'postgres',
    password: parsed.password || '',
    // Parse query params.
    ssl: parsed.searchParams.get('ssl') || parsed.searchParams.get('sslmode'),
  }
}

/**
 * Build a libpq connection string from options.
 *
 * @param {object} options
 * @returns {string}
 */
function buildConnectionString(options) {
  const parts = []

  if (options.hostname) {
    ArrayPrototypePush(parts, `host=${quoteConnValue(options.hostname)}`)
  }
  if (options.port) {
    // port is numeric; still safe to quote since libpq accepts quoted
    // integers. Keeps the builder uniform.
    ArrayPrototypePush(parts, `port=${quoteConnValue(options.port)}`)
  }
  if (options.database) {
    ArrayPrototypePush(parts, `dbname=${quoteConnValue(options.database)}`)
  }
  if (options.username) {
    ArrayPrototypePush(parts, `user=${quoteConnValue(options.username)}`)
  }
  if (options.password) {
    ArrayPrototypePush(parts, `password=${quoteConnValue(options.password)}`)
  }
  if (options.connectionTimeout) {
    ArrayPrototypePush(
      parts,
      `connect_timeout=${MathCeil(options.connectionTimeout / 1000)}`,
    )
  }

  // SSL mode.
  const ssl = options.ssl ?? options.tls
  if (ssl === true || ssl === 'require') {
    ArrayPrototypePush(parts, 'sslmode=require')
  } else if (ssl === 'verify-full') {
    ArrayPrototypePush(parts, 'sslmode=verify-full')
  } else if (ssl === 'verify-ca') {
    ArrayPrototypePush(parts, 'sslmode=verify-ca')
  } else if (ssl === 'prefer') {
    ArrayPrototypePush(parts, 'sslmode=prefer')
  } else if (ssl === false || ssl === 'disable') {
    ArrayPrototypePush(parts, 'sslmode=disable')
  }

  return ArrayPrototypeJoin(parts, ' ')
}

/**
 * PostgreSQL adapter class.
 * Wraps the native libpq bindings with connection pooling.
 */
class PostgresAdapter {
  [kPoolId];
  [kConfig];
  [kPreparedStatements] = new SafeMap();
  [kClosed] = false;
  [kPoolPromise] = undefined

  // Parameter placeholder style.
  paramStyle = '$'

  constructor(options) {
    this[kConfig] = options
    this[kPoolId] = undefined
  }

  /**
   * Initialize the connection pool.
   * Uses promise-based locking to prevent race conditions.
   * @returns {Promise<void>}
   */
  async #ensurePool() {
    // Fast path: pool already initialized
    if (this[kPoolId] !== undefined) {
      return
    }

    // Check if initialization is already in progress
    if (this[kPoolPromise] !== undefined) {
      return this[kPoolPromise]
    }

    // Start initialization with promise lock
    this[kPoolPromise] = this.#initPool()
    try {
      await this[kPoolPromise]
    } finally {
      this[kPoolPromise] = undefined
    }
  }

  /**
   * Actually initialize the pool (called once via #ensurePool lock).
   * @returns {Promise<void>}
   */
  async #initPool() {
    // Double-check in case of race (unlikely but safe)
    if (this[kPoolId] !== undefined) {
      return
    }

    const config = this[kConfig]
    const connString = config.url
      ? buildConnectionString(parseConnectionUrl(config.url))
      : buildConnectionString(config)

    const poolConfig = {
      __proto__: null,
      connectionString: connString,
      minConnections: config.min ?? 2,
      maxConnections: config.max ?? 10,
      connectTimeoutMs: config.connectionTimeout ?? 10_000,
      idleTimeoutMs: config.idleTimeout ?? 30_000,
      maxLifetimeMs: config.maxLifetime ?? 3_600_000,
    }

    this[kPoolId] = getBinding().createPool(poolConfig)
  }

  /**
   * Execute a query with parameters.
   *
   * @param {string} text - SQL query
   * @param {any[]} values - Parameter values
   * @param {string} format - Result format: 'objects', 'values', 'raw'
   * @returns {Promise<{result: any[], handle: any}>}
   */
  async query(text, values, format = 'objects') {
    await this.#ensurePool()

    const config = this[kConfig]

    // Check for prepared statement cache with LRU eviction.
    //
    // The cache is keyed by FNV-1a 32-bit hash for speed, but a bare hash
    // is not collision-free at 32 bits (50% birthday probability at ~65k
    // distinct queries, well within a long-running server's lifetime). A
    // collision would execute the WRONG query with the caller's values —
    // silent data corruption (a SELECT returning DELETE's effect or vice
    // versa). Store {name, text} and verify text matches on cache hit;
    // on mismatch, rehash under a suffix so both queries coexist.
    const hash = hashQuery(text)
    const cache = this[kPreparedStatements]
    let stmtName
    let cacheKey = hash
    // Walk collision-chain: same 32-bit hash + different text → rehash
    // under ${hash}#1, ${hash}#2, … until we find our text or an empty
    // slot. In practice the first probe wins ~always; the chain bound
    // is the cache size (capped by PREPARED_STMT_CACHE_MAX_SIZE).
    for (let probe = 0; probe < PREPARED_STMT_CACHE_MAX_SIZE; probe++) {
      cacheKey = probe === 0 ? hash : `${hash}#${probe}`
      const entry = lruGet(cache, cacheKey)
      if (entry === undefined) {
        stmtName = undefined
        break
      }
      if (entry.text === text) {
        stmtName = entry.name
        break
      }
    }

    if (stmtName === undefined) {
      // Create new prepared statement. Include the cacheKey in the
      // server-side name so colliding queries get distinct names.
      stmtName = `stmt_${cacheKey}`
      // 0 = infer type
      const paramLen = values.length
      const paramTypes = new Array(paramLen)
      for (let i = 0; i < paramLen; i++) {
        paramTypes[i] = 0
      }
      getBinding().prepareSync(this[kPoolId], stmtName, text, paramTypes)
      // Note: We don't deallocate evicted statements on the server
      // as it's a relatively minor memory overhead and avoids network roundtrip
      lruSet(
        cache,
        cacheKey,
        { __proto__: null, name: stmtName, text },
        PREPARED_STMT_CACHE_MAX_SIZE,
      )
    }

    // Execute prepared statement.
    // Use synchronous path when available — avoids Promise/callback/event-loop
    // overhead for what is typically a fast CPU-bound operation on cached
    // prepared statements.
    //
    // NOTE: we do NOT fall back to executePreparedAsync on sync failure.
    // Once libpq has been handed the statement, we can't tell from the
    // sync-side throw whether the server already applied the write — and
    // retrying an INSERT/UPDATE/DELETE on that uncertainty corrupts data
    // (silent duplicates under transient errors). See R34 scan.
    let rawResult
    try {
      rawResult = getBinding().executePreparedSync(
        this[kPoolId],
        stmtName,
        values,
        config.bigint ?? false,
      )
    } catch (syncErr) {
      throw createPostgresError(syncErr)
    }

    // Format result based on requested format.
    let result
    if (format === 'objects') {
      result = rowsToObjects(rawResult.rows, rawResult.columns)
    } else if (format === 'values') {
      result = rawResult.rows
    } else if (format === 'raw') {
      result = rawResult.rawRows
    } else {
      result = rowsToObjects(rawResult.rows, rawResult.columns)
    }

    return { __proto__: null, result, handle: rawResult.handle }
  }

  /**
   * Execute a query on a specific connection (for transactions).
   * Uses the pool-level executePreparedAsync binding since per-connection
   * async execution is not yet available in the native layer.
   *
   * @param {object} conn - Connection object (unused — routed through pool)
   * @param {string} text - SQL query
   * @param {any[]} values - Parameter values
   * @returns {Promise<any[]>}
   */
  async queryOnConnection(conn, text, values) {
    // Fall back to pool-level query until per-connection async is available.
    const { result } = await this.query(text, values, 'objects')
    return result
  }

  /**
   * Acquire an exclusive connection from the pool.
   * The native binding is synchronous; we wrap it to match the async API.
   * @returns {Promise<object>}
   */
  async acquireConnection() {
    await this.#ensurePool()

    const conn = getBinding().acquireConnection(this[kPoolId])
    if (conn === undefined) {
      throw new PostgresError('Connection acquisition failed', {
        __proto__: null,
        code: '08000', // CONNECTION_EXCEPTION
      })
    }
    return conn
  }

  /**
   * Release a connection back to the pool.
   * @param {object} conn
   */
  releaseConnection(conn) {
    getBinding().releaseConnection(conn)
  }

  /**
   * Execute a simple SQL query synchronously (no parameters).
   * Faster than async for simple queries — avoids event loop overhead.
   * @param {string} text - SQL query
   * @param {string} [format='objects'] - Result format
   * @returns {{ result: any, handle: any }}
   */
  executeSync(text, format = 'objects') {
    const rawResult = getBinding().executeSync(this[kPoolId], text)
    let result
    if (format === 'objects') {
      result = rowsToObjects(rawResult.rows, rawResult.columns)
    } else if (format === 'values') {
      result = rawResult.rows
    } else {
      result = rowsToObjects(rawResult.rows, rawResult.columns)
    }
    return { __proto__: null, result, handle: rawResult.handle }
  }

  /**
   * Execute a parameterized SQL query synchronously.
   * @param {string} text - SQL query with $1, $2, etc. placeholders
   * @param {any[]} values - Parameter values
   * @param {string} [format='objects'] - Result format
   * @returns {{ result: any, handle: any }}
   */
  executeParamsSync(text, values, format = 'objects') {
    const rawResult = getBinding().executeParamsSync(
      this[kPoolId],
      text,
      values,
    )
    let result
    if (format === 'objects') {
      result = rowsToObjects(rawResult.rows, rawResult.columns)
    } else if (format === 'values') {
      result = rawResult.rows
    } else {
      result = rowsToObjects(rawResult.rows, rawResult.columns)
    }
    return { __proto__: null, result, handle: rawResult.handle }
  }

  /**
   * Execute a prepared statement synchronously.
   * @param {string} stmtName - Prepared statement name
   * @param {any[]} values - Parameter values
   * @param {string} [format='objects'] - Result format
   * @returns {{ result: any, handle: any }}
   */
  executePreparedSync(stmtName, values, format = 'objects') {
    const rawResult = getBinding().executePreparedSync(
      this[kPoolId],
      stmtName,
      values,
      false,
    )
    let result
    if (format === 'objects') {
      result = rowsToObjects(rawResult.rows, rawResult.columns)
    } else if (format === 'values') {
      result = rawResult.rows
    } else {
      result = rowsToObjects(rawResult.rows, rawResult.columns)
    }
    return { __proto__: null, result, handle: rawResult.handle }
  }

  /**
   * Get connection pool statistics.
   * @returns {{ idle: number, active: number, total: number, healthy: boolean }}
   */
  getPoolStats() {
    return getBinding().getPoolStats(this[kPoolId])
  }

  /**
   * Close all connections.
   * @param {object} options
   * @returns {Promise<void>}
   */
  async close(options = kEmptyObject) {
    if (this[kClosed]) {
      return
    }
    this[kClosed] = true

    if (this[kPoolId] !== undefined) {
      getBinding().destroyPool(this[kPoolId])
      this[kPoolId] = undefined
    }
  }
}

/**
 * Create a PostgresError from native error.
 * @param {object} err
 * @returns {PostgresError}
 */
function createPostgresError(err) {
  return new PostgresError(err.message, {
    __proto__: null,
    code: err.code,
    severity: err.severity,
    detail: err.detail,
    hint: err.hint,
    position: err.position,
    internalPosition: err.internalPosition,
    internalQuery: err.internalQuery,
    where: err.where,
    schema: err.schema,
    table: err.table,
    column: err.column,
    dataType: err.dataType,
    constraint: err.constraint,
    file: err.file,
    line: err.line,
    routine: err.routine,
  })
}

/**
 * Create a new PostgreSQL adapter.
 * @param {object} options
 * @returns {PostgresAdapter}
 */
function create(options) {
  return new PostgresAdapter(options)
}

module.exports = {
  __proto__: null,
  create,
  PostgresAdapter,
  parseConnectionUrl,
  buildConnectionString,
}
