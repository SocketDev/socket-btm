'use strict';

// SQLite Adapter
// Wraps Node.js built-in node:sqlite with unified SQL API.

const {
  ArrayIsArray,
  ArrayPrototypeMap,
  ArrayPrototypePush,
  IteratorPrototypeNext,
  IteratorPrototypeReturn,
  MapPrototypeClear,
  NumberIsInteger,
  ObjectKeys,
  RegExpPrototypeExec,
  SafeMap,
  StringPrototypeSlice,
  StringPrototypeStartsWith,
  StringPrototypeToUpperCase,
  StringPrototypeTrim,
  Symbol: SymbolCtor,
  hardenRegExp,
} = primordials;

// Maximum number of cached prepared statements per connection.
const STATEMENT_CACHE_MAX_SIZE = 500;

// Pre-compiled regex for SQLite error code extraction.
const SQLITE_ERROR_CODE_REGEX = hardenRegExp(/^(SQLITE_\w+)/);

const {
  codes: {
    ERR_INVALID_ARG_VALUE,
  },
} = require('internal/errors');

const { kEmptyObject } = require('internal/util');
const { SQLiteError } = require('internal/socketsecurity/sql/errors');
const { rowsToObjects } = require('internal/socketsecurity/sql/result');
const { lruGetOrCreate } = require('internal/socketsecurity/sql/cache');

// Native SQLite binding.
let DatabaseSync;

function getDatabase() {
  if (!DatabaseSync) {
    const sqlite = require('sqlite');
    DatabaseSync = sqlite.DatabaseSync;
  }
  return DatabaseSync;
}

// Symbols for internal state.
const kDb = SymbolCtor('kDb');
const kConfig = SymbolCtor('kConfig');
const kStatementCache = SymbolCtor('kStatementCache');
const kClosed = SymbolCtor('kClosed');

/**
 * Get or create a cached prepared statement with query type detection.
 * Shared helper to avoid duplication between query() and createCursor().
 *
 * @param {SafeMap} cache - Statement cache
 * @param {object} db - Database instance
 * @param {string} text - SQL query text
 * @returns {object} Cached statement object with stmt and isSelect properties
 */
function getOrCreateStatement(cache, db, text) {
  return lruGetOrCreate(
    cache,
    text,
    STATEMENT_CACHE_MAX_SIZE,
    () => ({
      __proto__: null,
      stmt: db.prepare(text),
      isSelect: isSelectQuery(text),
    }),
  );
}

/**
 * Parse a SQLite connection URL or path.
 *
 * @param {string} url
 * @returns {string} - File path or :memory:
 */
function parseConnectionUrl(url) {
  if (url === ':memory:' || StringPrototypeStartsWith(url, ':memory:')) {
    return ':memory:';
  }

  if (StringPrototypeStartsWith(url, 'sqlite://')) {
    return StringPrototypeSlice(url, 9);
  }

  if (StringPrototypeStartsWith(url, 'file://')) {
    return StringPrototypeSlice(url, 7);
  }

  // Assume it's a file path.
  return url;
}

/**
 * SQLite adapter class.
 * Wraps node:sqlite DatabaseSync with async-like API.
 */
class SQLiteAdapter {
  [kDb];
  [kConfig];
  [kStatementCache] = new SafeMap();
  [kClosed] = false;

  // Parameter placeholder style.
  paramStyle = '?';

  constructor(options) {
    this[kConfig] = options;
    this[kDb] = undefined;
  }

  /**
   * Ensure database is open.
   */
  #ensureDb() {
    if (this[kDb]) {
      return;
    }

    const config = this[kConfig];
    let filename;

    if (config.url) {
      filename = parseConnectionUrl(config.url);
    } else if (config.filename) {
      filename = config.filename;
    } else {
      filename = ':memory:';
    }

    const Database = getDatabase();
    this[kDb] = new Database(filename, {
      open: true,
      readOnly: config.readonly ?? false,
      enableForeignKeyConstraints: config.foreignKeys ?? true,
    });

    // Performance pragmas.
    if (!config.readonly) {
      this[kDb].exec('PRAGMA journal_mode=WAL');
      this[kDb].exec('PRAGMA synchronous=NORMAL');
    }
    this[kDb].exec('PRAGMA busy_timeout=5000');
    this[kDb].exec('PRAGMA cache_size=-64000');
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
    this.#ensureDb();

    try {
      // Get or create prepared statement with LRU eviction.
      const cached = getOrCreateStatement(this[kStatementCache], this[kDb], text);

      // Execute based on cached statement type.
      let result;
      if (cached.isSelect) {
        // SELECT - returns rows.
        const rows = cached.stmt.all(...values);

        if (format === 'objects') {
          result = rows;
        } else if (format === 'values') {
          // Convert objects to arrays.
          const rowsLen = rows.length;
          if (rowsLen > 0) {
            const columns = ObjectKeys(rows[0]);
            const colLen = columns.length;
            result = new Array(rowsLen);
            for (let i = 0; i < rowsLen; i++) {
              const row = rows[i];
              const rowArr = new Array(colLen);
              for (let j = 0; j < colLen; j++) {
                rowArr[j] = row[columns[j]];
              }
              result[i] = rowArr;
            }
          } else {
            result = [];
          }
        } else {
          result = rows;
        }
      } else {
        // INSERT/UPDATE/DELETE - returns changes info.
        const info = cached.stmt.run(...values);
        result = [{
          __proto__: null,
          changes: info.changes,
          lastInsertRowid: info.lastInsertRowid,
        }];
      }

      return { __proto__: null, result, handle: undefined };
    } catch (err) {
      throw createSQLiteError(err);
    }
  }

  /**
   * Execute a query on a specific connection (for transactions).
   * SQLite uses a single connection, so this is the same as query().
   *
   * @param {object} conn - Connection object (ignored for SQLite)
   * @param {string} text - SQL query
   * @param {any[]} values - Parameter values
   * @returns {Promise<any[]>}
   */
  async queryOnConnection(conn, text, values) {
    const { result } = await this.query(text, values, 'objects');
    return result;
  }

  /**
   * Acquire an exclusive connection.
   * SQLite uses a single connection, so this returns a marker.
   *
   * @returns {Promise<object>}
   */
  async acquireConnection() {
    this.#ensureDb();
    return { __proto__: null, sqlite: true };
  }

  /**
   * Release a connection.
   * No-op for SQLite (single connection).
   *
   * @param {object} conn
   */
  releaseConnection(conn) {
    // No-op for SQLite.
  }

  /**
   * Create a cursor for streaming results.
   * SQLite uses statement iterator. Reuses cached statements when available.
   *
   * @param {string} text - SQL query
   * @param {any[]} values - Parameter values
   * @returns {Promise<object>}
   */
  async createCursor(text, values) {
    this.#ensureDb();

    try {
      // Use cached statement if available with LRU eviction.
      const cached = getOrCreateStatement(this[kStatementCache], this[kDb], text);
      const iterator = cached.stmt.iterate(...values);

      return {
        __proto__: null,
        iterator,
        columns: undefined, // Will be set on first fetch.
      };
    } catch (err) {
      throw createSQLiteError(err);
    }
  }

  /**
   * Fetch rows from a cursor.
   *
   * @param {object} cursor
   * @param {number} count - Number of rows to fetch
   * @returns {Promise<object[]>}
   */
  async fetchCursor(cursor, count) {
    const rows = [];
    let fetched = 0;

    try {
      while (fetched < count) {
        const { done, value } = IteratorPrototypeNext(cursor.iterator);
        if (done) {
          break;
        }
        ArrayPrototypePush(rows, value);
        fetched++;
      }

      return rows;
    } catch (err) {
      throw createSQLiteError(err);
    }
  }

  /**
   * Close a cursor.
   *
   * @param {object} cursor
   * @returns {Promise<void>}
   */
  async closeCursor(cursor) {
    // SQLite iterators close automatically when exhausted.
    // If we need to close early, we can use return().
    // Use safe primordial to avoid prototype pollution.
    IteratorPrototypeReturn(cursor.iterator);
  }

  /**
   * Cancel a running query.
   * SQLite queries are synchronous, so this is a no-op.
   *
   * @param {object} handle
   */
  cancelQuery(handle) {
    // No-op for SQLite - queries are synchronous.
  }

  /**
   * Close the database connection.
   *
   * @param {object} options
   * @returns {Promise<void>}
   */
  async close(options = kEmptyObject) {
    if (this[kClosed]) {
      return;
    }
    this[kClosed] = true;

    // Clear statement cache.
    MapPrototypeClear(this[kStatementCache]);

    if (this[kDb]) {
      this[kDb].close();
      this[kDb] = undefined;
    }
  }
}

/**
 * Check if a query is a SELECT (returns rows).
 *
 * @param {string} text
 * @returns {boolean}
 */
function isSelectQuery(text) {
  const trimmed = StringPrototypeToUpperCase(StringPrototypeTrim(text));
  return StringPrototypeStartsWith(trimmed, 'SELECT') ||
         StringPrototypeStartsWith(trimmed, 'WITH') ||
         StringPrototypeStartsWith(trimmed, 'PRAGMA') ||
         StringPrototypeStartsWith(trimmed, 'EXPLAIN');
}

/**
 * Create a SQLiteError from native error.
 *
 * @param {Error} err
 * @returns {SQLiteError}
 */
function createSQLiteError(err) {
  // Extract SQLite error code from message if available.
  let code = 'SQLITE_ERROR';
  let errcode;

  // SQLite errors often contain code in format: SQLITE_CONSTRAINT: ...
  const match = RegExpPrototypeExec(SQLITE_ERROR_CODE_REGEX, err.message);
  if (match) {
    code = match[1];
  }

  // Check for extended error code property.
  if (err.errcode !== undefined) {
    errcode = err.errcode;
  }

  return new SQLiteError(err.message, {
    __proto__: null,
    code,
    errcode,
    errstr: err.message,
  });
}

/**
 * Create a new SQLite adapter.
 *
 * @param {object} options
 * @returns {SQLiteAdapter}
 */
function create(options) {
  return new SQLiteAdapter(options);
}

module.exports = {
  __proto__: null,
  create,
  SQLiteAdapter,
  parseConnectionUrl,
};
