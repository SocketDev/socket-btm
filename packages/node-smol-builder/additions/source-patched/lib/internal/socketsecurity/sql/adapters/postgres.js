'use strict';

// PostgreSQL Adapter
// High-performance PostgreSQL client using libpq native bindings.

const {
  ArrayPrototypeJoin,
  ArrayPrototypeMap,
  ArrayPrototypePush,
  MathCeil,
  NumberIsInteger,
  NumberParseInt,
  ObjectAssign,
  Promise: PromiseCtor,
  PromiseRace,
  SafeMap,
  StringPrototypeSlice,
  StringPrototypeStartsWith,
  Symbol: SymbolCtor,
  URL,
} = primordials;

// Maximum number of cached prepared statements per connection.
const PREPARED_STMT_CACHE_MAX_SIZE = 500;

const {
  codes: {
    ERR_INVALID_ARG_TYPE,
    ERR_INVALID_ARG_VALUE,
  },
} = require('internal/errors');

const { validateObject, validateString } = require('internal/validators');
const { kEmptyObject } = require('internal/util');
const { PostgresError } = require('internal/socketsecurity/sql/errors');
const { hashQuery } = require('internal/socketsecurity/sql/query');
const { rowsToObjects } = require('internal/socketsecurity/sql/result');
const { lruGet, lruSet } = require('internal/socketsecurity/sql/cache');
const { SetTimeout, ClearTimeout } = require('internal/socketsecurity/safe-references');

// Native binding - loaded lazily.
let binding;

function getBinding() {
  binding ??= internalBinding('smol_postgres');
  return binding;
}

// Symbols for internal state.
const kPoolId = SymbolCtor('kPoolId');
const kConfig = SymbolCtor('kConfig');
const kPreparedStatements = SymbolCtor('kPreparedStatements');
const kClosed = SymbolCtor('kClosed');
const kPoolPromise = SymbolCtor('kPoolPromise');

/**
 * Parse a PostgreSQL connection URL.
 * Format: postgres://user:pass@host:port/database?params
 *
 * @param {string} url
 * @returns {object}
 */
function parseConnectionUrl(url) {
  // Use URL parser for robust parsing.
  const parsed = new URL(url);

  const port = parsed.port ? NumberParseInt(parsed.port, 10) : 5432;
  return {
    __proto__: null,
    hostname: parsed.hostname || 'localhost',
    port: NumberIsInteger(port) ? port : 5432,
    database: StringPrototypeSlice(parsed.pathname, 1) || 'postgres',
    username: parsed.username || 'postgres',
    password: parsed.password || '',
    // Parse query params.
    ssl: parsed.searchParams.get('ssl') || parsed.searchParams.get('sslmode'),
  };
}

/**
 * Build a libpq connection string from options.
 *
 * @param {object} options
 * @returns {string}
 */
function buildConnectionString(options) {
  const parts = [];

  if (options.hostname) {
    ArrayPrototypePush(parts, `host=${options.hostname}`);
  }
  if (options.port) {
    ArrayPrototypePush(parts, `port=${options.port}`);
  }
  if (options.database) {
    ArrayPrototypePush(parts, `dbname=${options.database}`);
  }
  if (options.username) {
    ArrayPrototypePush(parts, `user=${options.username}`);
  }
  if (options.password) {
    ArrayPrototypePush(parts, `password=${options.password}`);
  }
  if (options.connectionTimeout) {
    ArrayPrototypePush(parts, `connect_timeout=${MathCeil(options.connectionTimeout / 1000)}`);
  }

  // SSL mode.
  const ssl = options.ssl ?? options.tls;
  if (ssl === true || ssl === 'require') {
    ArrayPrototypePush(parts, 'sslmode=require');
  } else if (ssl === 'verify-full') {
    ArrayPrototypePush(parts, 'sslmode=verify-full');
  } else if (ssl === 'verify-ca') {
    ArrayPrototypePush(parts, 'sslmode=verify-ca');
  } else if (ssl === 'prefer') {
    ArrayPrototypePush(parts, 'sslmode=prefer');
  } else if (ssl === false || ssl === 'disable') {
    ArrayPrototypePush(parts, 'sslmode=disable');
  }

  return ArrayPrototypeJoin(parts, ' ');
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
  [kPoolPromise] = undefined;

  // Parameter placeholder style.
  paramStyle = '$';

  constructor(options) {
    this[kConfig] = options;
    this[kPoolId] = undefined;
  }

  /**
   * Initialize the connection pool.
   * Uses promise-based locking to prevent race conditions.
   * @returns {Promise<void>}
   */
  async #ensurePool() {
    // Fast path: pool already initialized
    if (this[kPoolId] !== undefined) {
      return;
    }

    // Check if initialization is already in progress
    if (this[kPoolPromise] !== undefined) {
      return this[kPoolPromise];
    }

    // Start initialization with promise lock
    this[kPoolPromise] = this.#initPool();
    try {
      await this[kPoolPromise];
    } finally {
      this[kPoolPromise] = undefined;
    }
  }

  /**
   * Actually initialize the pool (called once via #ensurePool lock).
   * @returns {Promise<void>}
   */
  async #initPool() {
    // Double-check in case of race (unlikely but safe)
    if (this[kPoolId] !== undefined) {
      return;
    }

    const config = this[kConfig];
    const connString = config.url
      ? buildConnectionString(parseConnectionUrl(config.url))
      : buildConnectionString(config);

    const poolConfig = {
      __proto__: null,
      connectionString: connString,
      minConnections: config.min ?? 2,
      maxConnections: config.max ?? 10,
      connectTimeoutMs: config.connectionTimeout ?? 10000,
      idleTimeoutMs: config.idleTimeout ?? 30000,
      maxLifetimeMs: config.maxLifetime ?? 3600000,
    };

    this[kPoolId] = getBinding().createPool(poolConfig);
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
    await this.#ensurePool();

    const config = this[kConfig];

    // Check for prepared statement cache with LRU eviction.
    const hash = hashQuery(text);
    const cache = this[kPreparedStatements];
    let stmtName = lruGet(cache, hash);

    if (stmtName === undefined) {
      // Create new prepared statement.
      stmtName = `stmt_${hash}`;
      // 0 = infer type
      const paramLen = values.length;
      const paramTypes = new Array(paramLen);
      for (let i = 0; i < paramLen; i++) {
        paramTypes[i] = 0;
      }
      getBinding().prepare(this[kPoolId], stmtName, text, paramTypes);
      // Note: We don't deallocate evicted statements on the server
      // as it's a relatively minor memory overhead and avoids network roundtrip
      lruSet(cache, hash, stmtName, PREPARED_STMT_CACHE_MAX_SIZE);
    }

    // Execute prepared statement.
    const rawResult = await new PromiseCtor((resolve, reject) => {
      getBinding().executePreparedAsync(
        this[kPoolId],
        stmtName,
        values,
        config.bigint ?? false,
        (err, result) => {
          if (err) {
            reject(createPostgresError(err));
          } else {
            resolve(result);
          }
        },
      );
    });

    // Format result based on requested format.
    let result;
    if (format === 'objects') {
      result = rowsToObjects(rawResult.rows, rawResult.columns);
    } else if (format === 'values') {
      result = rawResult.rows;
    } else if (format === 'raw') {
      result = rawResult.rawRows;
    } else {
      result = rowsToObjects(rawResult.rows, rawResult.columns);
    }

    return { __proto__: null, result, handle: rawResult.handle };
  }

  /**
   * Execute a query on a specific connection (for transactions).
   *
   * @param {object} conn - Connection object
   * @param {string} text - SQL query
   * @param {any[]} values - Parameter values
   * @returns {Promise<any[]>}
   */
  async queryOnConnection(conn, text, values) {
    const config = this[kConfig];

    return new PromiseCtor((resolve, reject) => {
      getBinding().executeOnConnectionAsync(
        conn,
        text,
        values,
        config.bigint ?? false,
        (err, result) => {
          if (err) {
            reject(createPostgresError(err));
          } else {
            resolve(rowsToObjects(result.rows, result.columns));
          }
        },
      );
    });
  }

  /**
   * Acquire an exclusive connection from the pool.
   * @returns {Promise<object>}
   */
  async acquireConnection() {
    await this.#ensurePool();

    const config = this[kConfig];
    const timeoutMs = config.connectionTimeout ?? 10000;

    const acquirePromise = new PromiseCtor((resolve, reject) => {
      getBinding().acquireConnection(this[kPoolId], (err, conn) => {
        if (err) {
          reject(createPostgresError(err));
        } else {
          resolve(conn);
        }
      });
    });

    // Race against timeout to prevent indefinite waiting.
    let timeoutId;
    const timeoutPromise = new PromiseCtor((_, reject) => {
      timeoutId = SetTimeout(() => {
        reject(new PostgresError('Connection acquisition timed out', {
          __proto__: null,
          code: '08000', // CONNECTION_EXCEPTION
        }));
      }, timeoutMs);
    });

    try {
      return await PromiseRace([acquirePromise, timeoutPromise]);
    } finally {
      ClearTimeout(timeoutId);
    }
  }

  /**
   * Release a connection back to the pool.
   * @param {object} conn
   */
  releaseConnection(conn) {
    getBinding().releaseConnection(this[kPoolId], conn);
  }

  /**
   * Create a cursor for streaming results.
   *
   * @param {string} text - SQL query
   * @param {any[]} values - Parameter values
   * @returns {Promise<object>}
   */
  async createCursor(text, values) {
    await this.#ensurePool();

    return new PromiseCtor((resolve, reject) => {
      getBinding().createCursor(
        this[kPoolId],
        text,
        values,
        (err, cursor) => {
          if (err) {
            reject(createPostgresError(err));
          } else {
            resolve(cursor);
          }
        },
      );
    });
  }

  /**
   * Fetch rows from a cursor.
   *
   * @param {object} cursor
   * @param {number} count - Number of rows to fetch
   * @returns {Promise<object[]>}
   */
  async fetchCursor(cursor, count) {
    const config = this[kConfig];

    return new PromiseCtor((resolve, reject) => {
      getBinding().fetchCursor(
        cursor,
        count,
        config.bigint ?? false,
        (err, result) => {
          if (err) {
            reject(createPostgresError(err));
          } else {
            resolve(rowsToObjects(result.rows, result.columns));
          }
        },
      );
    });
  }

  /**
   * Close a cursor.
   * @param {object} cursor
   * @returns {Promise<void>}
   */
  async closeCursor(cursor) {
    return new PromiseCtor((resolve, reject) => {
      getBinding().closeCursor(cursor, (err) => {
        if (err) {
          reject(createPostgresError(err));
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Cancel a running query.
   * @param {object} handle
   */
  cancelQuery(handle) {
    if (handle) {
      getBinding().cancelQuery(handle);
    }
  }

  /**
   * Close all connections.
   * @param {object} options
   * @returns {Promise<void>}
   */
  async close(options = kEmptyObject) {
    if (this[kClosed]) {
      return;
    }
    this[kClosed] = true;

    if (this[kPoolId] !== undefined) {
      const timeout = options.timeout ?? 5;
      await new PromiseCtor((resolve) => {
        getBinding().destroyPool(this[kPoolId], timeout * 1000, resolve);
      });
      this[kPoolId] = undefined;
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
  });
}

/**
 * Create a new PostgreSQL adapter.
 * @param {object} options
 * @returns {PostgresAdapter}
 */
function create(options) {
  return new PostgresAdapter(options);
}

module.exports = {
  __proto__: null,
  create,
  PostgresAdapter,
  parseConnectionUrl,
  buildConnectionString,
};
