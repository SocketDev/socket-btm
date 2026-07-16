'use strict'

// node:sql - Unified SQL API
// High-performance, Bun-compatible SQL interface for PostgreSQL and SQLite.

const {
  ArrayIsArray,
  ArrayPrototypeFilter,
  ArrayPrototypeIncludes,
  ArrayPrototypeJoin,
  ArrayPrototypeMap,
  ArrayPrototypePush,
  ArrayPrototypeSlice,
  FunctionPrototypeBind,
  JSONStringify,
  NumberIsInteger,
  ObjectAssign,
  ObjectDefineProperty,
  ObjectDefineProperties,
  ObjectFreeze,
  ObjectHasOwn,
  ObjectKeys,
  PromisePrototypeThen,
  ReflectApply,
  SafeMap,
  SafeSet,
  SetPrototypeHas,
  WeakMapPrototypeGet,
  WeakMapPrototypeSet,
  String: StringCtor,
  StringPrototypeReplace,
  StringPrototypeSlice,
  StringPrototypeStartsWith,
  StringPrototypeToLowerCase,
  Symbol: SymbolCtor,
  SymbolAsyncIterator,
  SymbolToStringTag,
  hardenRegExp,
} = primordials

// Pre-compiled regex for SQL string escaping (single quotes).
const SQL_SINGLE_QUOTE_REGEX = hardenRegExp(/'/g)

const {
  codes: { ERR_INVALID_ARG_TYPE, ERR_INVALID_ARG_VALUE },
} = require('internal/errors')

const {
  validateFunction,
  validateObject,
  validateString,
} = require('internal/validators')
const { kEmptyObject } = require('internal/util')

const {
  getTemplateCache,
  parseQuery,
  buildInsertQuery,
  escapeIdentifier,
} = require('internal/socketsecurity/sql/query')
const {
  FsReadFileSync,
  ProcessEnv,
} = require('internal/socketsecurity/safe-references')
const { SQLResult } = require('internal/socketsecurity/sql/result')
const {
  Transaction,
  Savepoint,
} = require('internal/socketsecurity/sql/transaction')
const {
  SQLError,
  PostgresError,
  SQLiteError,
  SQLConnectionClosedError,
  SQLTransactionCommittedError,
  SQLTransactionRolledBackError,
  SQLTransactionNotStartedError,
  PG_ERROR_CODES,
  SQLITE_ERROR_CODES,
  // Error type guards
  isUniqueViolation,
  isForeignKeyViolation,
  isNotNullViolation,
  isCheckViolation,
  isConnectionError,
  isSyntaxError,
  isUndefinedTable,
} = require('internal/socketsecurity/sql/errors')

// Lazy-loaded adapters to avoid circular dependencies and unnecessary init.
let postgresAdapter
let sqliteAdapter

function getPostgresAdapter() {
  postgresAdapter ??= require('internal/socketsecurity/sql/adapters/postgres')
  return postgresAdapter
}

function getSQLiteAdapter() {
  sqliteAdapter ??= require('internal/socketsecurity/sql/adapters/sqlite')
  return sqliteAdapter
}

// Symbols for internal state.
const kAdapter = SymbolCtor('kAdapter')
const kOptions = SymbolCtor('kOptions')
const kClosed = SymbolCtor('kClosed')

/**
 * Transaction isolation levels.
 * Use these constants to avoid typos in transaction options.
 */
const IsolationLevel = ObjectFreeze({
  __proto__: null,
  READ_UNCOMMITTED: 'read uncommitted',
  READ_COMMITTED: 'read committed',
  REPEATABLE_READ: 'repeatable read',
  SERIALIZABLE: 'serializable',
})

/**
 * Detect adapter type from URL or options.
 * @param {string|object} urlOrOptions
 * @returns {'postgres'|'sqlite'}
 */
function detectAdapter(urlOrOptions) {
  if (typeof urlOrOptions === 'string') {
    const url = StringPrototypeToLowerCase(urlOrOptions)
    if (
      StringPrototypeStartsWith(url, 'postgres://') ||
      StringPrototypeStartsWith(url, 'postgresql://')
    ) {
      return 'postgres'
    }
    if (
      StringPrototypeStartsWith(url, 'sqlite://') ||
      StringPrototypeStartsWith(url, 'file://') ||
      url === ':memory:' ||
      StringPrototypeStartsWith(url, ':memory:')
    ) {
      return 'sqlite'
    }
    // Default to postgres for bare hostnames/URLs.
    return 'postgres'
  }

  if (urlOrOptions?.adapter) {
    return urlOrOptions.adapter
  }

  if (urlOrOptions?.filename) {
    return 'sqlite'
  }

  return 'postgres'
}

/**
 * SQLFragment - represents a safely escaped SQL fragment.
 * Used for dynamic identifiers, IN clauses, and bulk inserts.
 */
class SQLFragment {
  #text
  #values

  constructor(text, values = []) {
    this.#text = text
    this.#values = values
  }

  get text() {
    return this.#text
  }

  get values() {
    return this.#values
  }

  toString() {
    return this.#text
  }
}

ObjectDefineProperty(SQLFragment.prototype, SymbolToStringTag, {
  __proto__: null,
  configurable: true,
  value: 'SQLFragment',
})

/**
 * SQLQuery - represents a pending SQL query.
 * Extends Promise for await support while providing additional methods.
 */
class SQLQuery {
  #adapter
  #text
  #values
  #promise
  #cancelled = false
  #queryHandle

  constructor(adapter, text, values) {
    this.#adapter = adapter
    this.#text = text
    this.#values = values
    this.#promise = undefined
  }

  /**
   * Execute the query and return rows as objects.
   * @returns {Promise<object[]>}
   */
  then(onFulfilled, onRejected) {
    this.#promise ??= this.#execute('objects')
    return PromisePrototypeThen(this.#promise, onFulfilled, onRejected)
  }

  /**
   * Execute and return rows as value arrays.
   * @returns {Promise<any[][]>}
   */
  values() {
    return this.#execute('values')
  }

  /**
   * Execute and return rows as raw Buffer arrays.
   * @returns {Promise<Buffer[][]>}
   */
  raw() {
    return this.#execute('raw')
  }

  /**
   * Stream rows one at a time.
   * @param {number} batchSize - Internal batch fetch size (must be positive integer, default 100)
   * @returns {AsyncIterable<object>}
   */
  stream(batchSize = 100) {
    // Validate batchSize to prevent invalid cursor operations.
    if (!NumberIsInteger(batchSize) || batchSize < 1) {
      throw new ERR_INVALID_ARG_VALUE(
        'batchSize',
        batchSize,
        'must be a positive integer',
      )
    }

    const adapter = this.#adapter
    const text = this.#text
    const values = this.#values

    return {
      __proto__: null,
      [SymbolAsyncIterator]: async function* streamIterator() {
        const cursor = await adapter.createCursor(text, values)
        try {
          let batch
          while (
            (batch = await adapter.fetchCursor(cursor, batchSize)).length > 0
          ) {
            for (let i = 0, batchLen = batch.length; i < batchLen; i++) {
              yield batch[i]
            }
          }
        } finally {
          await adapter.closeCursor(cursor)
        }
      },
    }
  }

  /**
   * Batch cursor for large result sets.
   * @param {number} batchSize - Number of rows per batch (must be positive integer, default 100)
   * @returns {AsyncIterable<object[]>}
   */
  cursor(batchSize = 100) {
    // Validate batchSize to prevent invalid cursor operations.
    if (!NumberIsInteger(batchSize) || batchSize < 1) {
      throw new ERR_INVALID_ARG_VALUE(
        'batchSize',
        batchSize,
        'must be a positive integer',
      )
    }

    const adapter = this.#adapter
    const text = this.#text
    const values = this.#values

    return {
      __proto__: null,
      [SymbolAsyncIterator]: async function* cursorIterator() {
        const cursor = await adapter.createCursor(text, values)
        try {
          let batch
          while (
            (batch = await adapter.fetchCursor(cursor, batchSize)).length > 0
          ) {
            yield batch
          }
        } finally {
          await adapter.closeCursor(cursor)
        }
      },
    }
  }

  /**
   * Start query execution (returns self for chaining).
   * @returns {SQLQuery}
   */
  execute() {
    this.#promise ??= this.#execute('objects')
    return this
  }

  /**
   * Cancel a running query.
   */
  cancel() {
    this.#cancelled = true
    if (this.#queryHandle) {
      this.#adapter.cancelQuery(this.#queryHandle)
    }
  }

  /**
   * Execute and return the first row only, or undefined if no rows.
   * Uses cursor to fetch only 1 row for memory efficiency.
   * @returns {Promise<object|undefined>}
   */
  async first() {
    // Use cursor for memory efficiency - only fetch 1 row
    const cursor = await this.#adapter.createCursor(this.#text, this.#values)
    try {
      const rows = await this.#adapter.fetchCursor(cursor, 1)
      return rows[0]
    } finally {
      await this.#adapter.closeCursor(cursor)
    }
  }

  /**
   * Execute and return whether any rows exist.
   * Uses cursor to fetch only 1 row for memory efficiency.
   * @returns {Promise<boolean>}
   */
  async exists() {
    // Use cursor for memory efficiency - only need to check if 1 row exists
    const cursor = await this.#adapter.createCursor(this.#text, this.#values)
    try {
      const rows = await this.#adapter.fetchCursor(cursor, 1)
      return rows.length > 0
    } finally {
      await this.#adapter.closeCursor(cursor)
    }
  }

  /**
   * Get query introspection info (without executing).
   * Useful for debugging, logging, or query analysis.
   * @returns {{text: string, values: any[], paramCount: number}}
   */
  getQuery() {
    return {
      __proto__: null,
      text: this.#text,
      values: ArrayPrototypeSlice(this.#values), // Defensive copy
      paramCount: this.#values.length,
    }
  }

  /**
   * Execute a COUNT query and return the count as a number.
   * Assumes the query returns a single row with a count column.
   * @returns {Promise<number>}
   */
  async count() {
    const rows = await this.#execute('values')
    if (rows.length === 0 || rows[0].length === 0) {
      return 0
    }
    // Return first value from first row (the count)
    const value = rows[0][0]
    return typeof value === 'bigint' ? Number(value) : (value ?? 0)
  }

  /**
   * Execute and return the last row only, or undefined if no rows.
   * Note: This loads all rows as there's no way to efficiently get only the last row
   * without modifying the query (e.g., reversing ORDER BY and adding LIMIT 1).
   * For large result sets, consider modifying your query directly.
   * @returns {Promise<object|undefined>}
   */
  async last() {
    const rows = await this.#execute('objects')
    return rows.length > 0 ? rows[rows.length - 1] : undefined
  }

  /**
   * Execute and return the first n rows.
   * Uses cursor to fetch only n rows for memory efficiency.
   * @param {number} n - Number of rows to return.
   * @returns {Promise<object[]>}
   */
  async take(n) {
    if (!NumberIsInteger(n) || n < 0) {
      throw new ERR_INVALID_ARG_VALUE('n', n, 'must be a non-negative integer')
    }
    if (n === 0) {
      return []
    }
    // Use cursor for memory efficiency - only fetch n rows
    const cursor = await this.#adapter.createCursor(this.#text, this.#values)
    try {
      return await this.#adapter.fetchCursor(cursor, n)
    } finally {
      await this.#adapter.closeCursor(cursor)
    }
  }

  async #execute(format) {
    if (this.#cancelled) {
      throw new SQLError('Query was cancelled')
    }
    const { result, handle } = await this.#adapter.query(
      this.#text,
      this.#values,
      format,
    )
    this.#queryHandle = handle
    return result
  }
}

// Make SQLQuery thenable (Promise-like).
ObjectDefineProperty(SQLQuery.prototype, SymbolToStringTag, {
  __proto__: null,
  configurable: true,
  value: 'SQLQuery',
})

/**
 * SQL - Main SQL client class.
 * Supports PostgreSQL and SQLite with a unified tagged template interface.
 */
class SQL {
  [kAdapter];
  [kOptions];
  [kClosed] = false

  /**
   * Create a new SQL client.
   * @param {string|object} urlOrOptions - Connection URL or options object.
   * @param {object} [options] - Additional options when URL is provided.
   */
  constructor(urlOrOptions, options) {
    if (urlOrOptions === undefined) {
      // Use environment variables for default connection (via safe-references).
      urlOrOptions =
        ProcessEnv.POSTGRES_URL || ProcessEnv.DATABASE_URL || kEmptyObject
    }

    let finalOptions
    if (typeof urlOrOptions === 'string') {
      finalOptions = ObjectAssign(
        { __proto__: null, url: urlOrOptions },
        options,
      )
    } else {
      validateObject(urlOrOptions, 'options')
      finalOptions = urlOrOptions
    }

    const adapterType = detectAdapter(urlOrOptions)
    this[kOptions] = finalOptions

    if (adapterType === 'postgres') {
      this[kAdapter] = getPostgresAdapter().create(finalOptions)
    } else if (adapterType === 'sqlite') {
      this[kAdapter] = getSQLiteAdapter().create(finalOptions)
    } else {
      throw new ERR_INVALID_ARG_VALUE(
        'adapter',
        adapterType,
        'must be "postgres" or "sqlite"',
      )
    }

    // Return a callable proxy that acts as both a constructor and tagged template.
    const self = this
    const handler = {
      __proto__: null,
      apply(target, thisArg, args) {
        // Called as tagged template: sql`...`
        return ReflectApply(self.#taggedTemplate, self, args)
      },
      get(target, prop, receiver) {
        // Access properties on the SQL instance.
        // Use ObjectHasOwn to prevent prototype pollution attacks.
        if (ObjectHasOwn(self, prop) || ObjectHasOwn(SQL.prototype, prop)) {
          const value = self[prop]
          if (typeof value === 'function') {
            return FunctionPrototypeBind(value, self)
          }
          return value
        }
        return undefined
      },
    }

    // eslint-disable-next-line no-constructor-return
    return new Proxy(function SQLTaggedTemplate() {}, handler)
  }

  /**
   * Tagged template handler for SQL queries.
   * @param {TemplateStringsArray} strings
   * @param {...any} values
   * @returns {SQLQuery}
   */
  #taggedTemplate(strings, ...values) {
    if (this[kClosed]) {
      throw new SQLConnectionClosedError()
    }

    // Check template cache for parsed query structure (separate cache per paramStyle).
    const paramStyle = this[kAdapter].paramStyle
    const templateCache = getTemplateCache(paramStyle)
    let cached = WeakMapPrototypeGet(templateCache, strings)
    if (!cached) {
      cached = parseQuery(strings, paramStyle)
      WeakMapPrototypeSet(templateCache, strings, cached)
    }

    // Build final query with provided values.
    // Use for loop instead of map for hot-path performance
    const { text, paramIndices } = cached
    const paramLen = paramIndices.length
    const queryValues = new Array(paramLen)
    for (let i = 0; i < paramLen; i++) {
      queryValues[i] = values[paramIndices[i]]
    }

    return new SQLQuery(this[kAdapter], text, queryValues)
  }

  /**
   * Begin a transaction.
   * @param {object|function} optionsOrFn - Transaction options or callback.
   * @param {function} [fn] - Transaction callback when options provided.
   * @returns {Promise<any>}
   */
  async begin(optionsOrFn, fn) {
    if (this[kClosed]) {
      throw new SQLConnectionClosedError()
    }

    let options = kEmptyObject
    let callback

    if (typeof optionsOrFn === 'function') {
      callback = optionsOrFn
    } else {
      validateObject(optionsOrFn, 'options')
      options = optionsOrFn
      validateFunction(fn, 'fn')
      callback = fn
    }

    const conn = await this[kAdapter].acquireConnection()
    const tx = new Transaction(this[kAdapter], conn, options)

    try {
      await tx.begin()
      const result = await callback(tx)
      await tx.commit()
      return result
    } catch (err) {
      await tx.rollback()
      throw err
    } finally {
      this[kAdapter].releaseConnection(conn)
    }
  }

  /**
   * Reserve an exclusive connection from the pool.
   * @returns {Promise<ReservedConnection>}
   */
  async reserve() {
    if (this[kClosed]) {
      throw new SQLConnectionClosedError()
    }

    const conn = await this[kAdapter].acquireConnection()
    return new ReservedConnection(this[kAdapter], conn)
  }

  /**
   * Close all connections.
   * @param {object} [options]
   * @param {number} [options.timeout] - Timeout in seconds.
   * @returns {Promise<void>}
   */
  async close(options = kEmptyObject) {
    if (this[kClosed]) {
      return
    }
    this[kClosed] = true
    await this[kAdapter].close(options)
  }

  /**
   * Execute raw SQL without parameterization.
   * WARNING: Only use with trusted input!
   * @param {string} query
   * @param {any[]} [params]
   * @returns {SQLQuery}
   */
  unsafe(query, params = []) {
    if (this[kClosed]) {
      throw new SQLConnectionClosedError()
    }
    validateString(query, 'query')
    return new SQLQuery(this[kAdapter], query, params)
  }

  /**
   * Execute SQL from a file.
   * @param {string} path
   * @param {any[]} [params]
   * @returns {SQLQuery}
   */
  file(path, params = []) {
    if (this[kClosed]) {
      throw new SQLConnectionClosedError()
    }
    validateString(path, 'path')
    const query = FsReadFileSync(path, 'utf8')
    return new SQLQuery(this[kAdapter], query, params)
  }

  /**
   * Find a row by its primary key (convenience method).
   * @param {string} table - Table name.
   * @param {any} id - Primary key value.
   * @param {string} [idColumn='id'] - Primary key column name.
   * @returns {Promise<object|undefined>} The found row or undefined.
   */
  async findById(table, id, idColumn = 'id') {
    if (this[kClosed]) {
      throw new SQLConnectionClosedError()
    }
    validateString(table, 'table')
    validateString(idColumn, 'idColumn')

    const paramStyle = this[kAdapter].paramStyle
    const param = paramStyle === '$' ? '$1' : '?'
    const query = `SELECT * FROM ${escapeIdentifier(table)} WHERE ${escapeIdentifier(idColumn)} = ${param} LIMIT 1`

    return new SQLQuery(this[kAdapter], query, [id]).first()
  }

  /**
   * Insert multiple rows in a single transaction (convenience method).
   * @param {string} table - Table name.
   * @param {object[]} rows - Array of row objects.
   * @param {object} [options] - Options.
   * @param {string[]} [options.columns] - Explicit column list (default: keys from first row).
   * @param {boolean} [options.returning] - Return inserted rows (PostgreSQL only).
   * @returns {Promise<object[]>} Inserted rows (if returning) or empty array.
   */
  async insertMany(table, rows, options) {
    if (this[kClosed]) {
      throw new SQLConnectionClosedError()
    }
    validateString(table, 'table')
    if (!ArrayIsArray(rows) || rows.length === 0) {
      throw new ERR_INVALID_ARG_VALUE('rows', rows, 'must be a non-empty array')
    }

    const { columns, returning } = { __proto__: null, ...options }
    const cols = columns ?? ObjectKeys(rows[0])
    const paramStyle = this[kAdapter].paramStyle
    const colsLen = cols.length

    // Validate all rows have the required columns (catch missing columns early)
    for (let i = 0, rowsLen = rows.length; i < rowsLen; i++) {
      const row = rows[i]
      for (let j = 0; j < colsLen; j++) {
        const col = cols[j]
        if (!ObjectHasOwn(row, col)) {
          throw new ERR_INVALID_ARG_VALUE(
            `rows[${i}]`,
            row,
            `missing column '${col}'`,
          )
        }
      }
    }

    // Build placeholders and values using shared helper
    const { rowPlaceholders, allValues } = buildRowPlaceholders(
      rows,
      cols,
      paramStyle,
    )

    const colNames = ArrayPrototypeJoin(
      ArrayPrototypeMap(cols, escapeIdentifier),
      ', ',
    )
    let query = `INSERT INTO ${escapeIdentifier(table)} (${colNames}) VALUES ${ArrayPrototypeJoin(rowPlaceholders, ', ')}`

    if (returning && paramStyle === '$') {
      query += ' RETURNING *'
    }

    return new SQLQuery(this[kAdapter], query, allValues)
  }

  /**
   * Insert or update a row (upsert) based on conflict columns.
   * @param {string} table - Table name.
   * @param {object} row - Row object.
   * @param {object} options - Options.
   * @param {string[]} options.conflictColumns - Columns to detect conflict on.
   * @param {string[]} [options.updateColumns] - Columns to update on conflict (default: all except conflict columns).
   * @param {boolean} [options.returning] - Return the row (PostgreSQL only).
   * @returns {Promise<object|undefined>}
   */
  async upsert(table, row, options) {
    if (this[kClosed]) {
      throw new SQLConnectionClosedError()
    }
    validateString(table, 'table')
    validateObject(row, 'row')
    validateObject(options, 'options')

    const { conflictColumns, updateColumns, returning } = {
      __proto__: null,
      ...options,
    }
    if (!ArrayIsArray(conflictColumns) || conflictColumns.length === 0) {
      throw new ERR_INVALID_ARG_VALUE(
        'options.conflictColumns',
        conflictColumns,
        'must be a non-empty array',
      )
    }

    const paramStyle = this[kAdapter].paramStyle
    const cols = ObjectKeys(row)
    // Use SafeSet for O(1) lookup instead of O(n) ArrayPrototypeIncludes.
    const conflictSet = new SafeSet(conflictColumns)
    const updateCols =
      updateColumns ??
      ArrayPrototypeFilter(cols, c => !SetPrototypeHas(conflictSet, c))

    // Build INSERT part
    let paramIndex = 1
    const placeholders = []
    const values = []
    for (let i = 0, colsLen = cols.length; i < colsLen; i++) {
      if (paramStyle === '$') {
        ArrayPrototypePush(placeholders, `$${paramIndex++}`)
      } else {
        ArrayPrototypePush(placeholders, '?')
      }
      ArrayPrototypePush(values, row[cols[i]])
    }

    const colNames = ArrayPrototypeJoin(
      ArrayPrototypeMap(cols, escapeIdentifier),
      ', ',
    )
    let query = `INSERT INTO ${escapeIdentifier(table)} (${colNames}) VALUES (${ArrayPrototypeJoin(placeholders, ', ')})`

    // Build ON CONFLICT clause - pre-escape columns once
    const conflictCols = ArrayPrototypeJoin(
      ArrayPrototypeMap(conflictColumns, escapeIdentifier),
      ', ',
    )
    const escapedUpdateCols = ArrayPrototypeMap(updateCols, escapeIdentifier)

    if (paramStyle === '$') {
      // PostgreSQL: ON CONFLICT ... DO UPDATE SET
      const updates = ArrayPrototypeMap(
        escapedUpdateCols,
        col => `${col} = EXCLUDED.${col}`,
      )
      query += ` ON CONFLICT (${conflictCols}) DO UPDATE SET ${ArrayPrototypeJoin(updates, ', ')}`
      if (returning) {
        query += ' RETURNING *'
      }
    } else {
      // SQLite: ON CONFLICT ... DO UPDATE SET
      const updates = ArrayPrototypeMap(
        escapedUpdateCols,
        col => `${col} = excluded.${col}`,
      )
      query += ` ON CONFLICT (${conflictCols}) DO UPDATE SET ${ArrayPrototypeJoin(updates, ', ')}`
    }

    return new SQLQuery(this[kAdapter], query, values).first()
  }

  /**
   * Insert or update multiple rows (batch upsert) using a single multi-row INSERT.
   * This is significantly more efficient than individual upserts (50-200x faster).
   * @param {string} table - Table name.
   * @param {object[]} rows - Array of row objects.
   * @param {object} options - Options.
   * @param {string[]} options.conflictColumns - Columns to detect conflict on.
   * @param {string[]} [options.updateColumns] - Columns to update on conflict.
   * @param {boolean} [options.returning] - Return the rows (PostgreSQL only).
   * @returns {Promise<object[]>}
   */
  async upsertMany(table, rows, options) {
    if (this[kClosed]) {
      throw new SQLConnectionClosedError()
    }
    validateString(table, 'table')
    if (!ArrayIsArray(rows) || rows.length === 0) {
      throw new ERR_INVALID_ARG_VALUE('rows', rows, 'must be a non-empty array')
    }
    validateObject(options, 'options')

    const { conflictColumns, updateColumns, returning } = {
      __proto__: null,
      ...options,
    }
    if (!ArrayIsArray(conflictColumns) || conflictColumns.length === 0) {
      throw new ERR_INVALID_ARG_VALUE(
        'options.conflictColumns',
        conflictColumns,
        'must be a non-empty array',
      )
    }

    const paramStyle = this[kAdapter].paramStyle
    const cols = ObjectKeys(rows[0])
    const colsLen = cols.length
    // Use SafeSet for O(1) lookup instead of O(n) ArrayPrototypeIncludes.
    const conflictSet = new SafeSet(conflictColumns)
    const updateCols =
      updateColumns ??
      ArrayPrototypeFilter(cols, c => !SetPrototypeHas(conflictSet, c))

    // Validate all rows have the required columns (catch missing columns early)
    for (let i = 0, rowsLen = rows.length; i < rowsLen; i++) {
      const row = rows[i]
      for (let j = 0; j < colsLen; j++) {
        const col = cols[j]
        if (!ObjectHasOwn(row, col)) {
          throw new ERR_INVALID_ARG_VALUE(
            `rows[${i}]`,
            row,
            `missing column '${col}'`,
          )
        }
      }
    }

    // Build placeholders and values using shared helper
    const { rowPlaceholders, allValues } = buildRowPlaceholders(
      rows,
      cols,
      paramStyle,
    )

    const colNames = ArrayPrototypeJoin(
      ArrayPrototypeMap(cols, escapeIdentifier),
      ', ',
    )
    let query = `INSERT INTO ${escapeIdentifier(table)} (${colNames}) VALUES ${ArrayPrototypeJoin(rowPlaceholders, ', ')}`

    // Build ON CONFLICT clause - pre-escape columns once
    const conflictCols = ArrayPrototypeJoin(
      ArrayPrototypeMap(conflictColumns, escapeIdentifier),
      ', ',
    )
    const escapedUpdateCols = ArrayPrototypeMap(updateCols, escapeIdentifier)

    if (paramStyle === '$') {
      // PostgreSQL: ON CONFLICT ... DO UPDATE SET with EXCLUDED
      const updates = ArrayPrototypeMap(
        escapedUpdateCols,
        col => `${col} = EXCLUDED.${col}`,
      )
      query += ` ON CONFLICT (${conflictCols}) DO UPDATE SET ${ArrayPrototypeJoin(updates, ', ')}`
      if (returning) {
        query += ' RETURNING *'
      }
    } else {
      // SQLite: ON CONFLICT ... DO UPDATE SET with excluded (lowercase)
      const updates = ArrayPrototypeMap(
        escapedUpdateCols,
        col => `${col} = excluded.${col}`,
      )
      query += ` ON CONFLICT (${conflictCols}) DO UPDATE SET ${ArrayPrototypeJoin(updates, ', ')}`
    }

    return new SQLQuery(this[kAdapter], query, allValues)
  }

  /**
   * Delete multiple rows by IDs (batch delete).
   * @param {string} table - Table name.
   * @param {any[]} ids - Array of IDs to delete.
   * @param {string} [idColumn='id'] - ID column name.
   * @returns {Promise<number>} Number of rows deleted.
   */
  async deleteMany(table, ids, idColumn = 'id') {
    if (this[kClosed]) {
      throw new SQLConnectionClosedError()
    }
    validateString(table, 'table')
    validateString(idColumn, 'idColumn')
    if (!ArrayIsArray(ids) || ids.length === 0) {
      throw new ERR_INVALID_ARG_VALUE('ids', ids, 'must be a non-empty array')
    }

    const paramStyle = this[kAdapter].paramStyle
    let placeholderStr

    if (paramStyle === '$') {
      // PostgreSQL: needs $1, $2, $3, ...
      const placeholders = []
      for (let i = 0, idsLen = ids.length; i < idsLen; i++) {
        ArrayPrototypePush(placeholders, `$${i + 1}`)
      }
      placeholderStr = ArrayPrototypeJoin(placeholders, ', ')
    } else {
      // SQLite: all placeholders are '?', pre-build template
      const placeholders = []
      for (let i = 0, idsLen = ids.length; i < idsLen; i++) {
        ArrayPrototypePush(placeholders, '?')
      }
      placeholderStr = ArrayPrototypeJoin(placeholders, ', ')
    }

    const query = `DELETE FROM ${escapeIdentifier(table)} WHERE ${escapeIdentifier(idColumn)} IN (${placeholderStr})`
    // Use adapter.query directly to access handle metadata (changes/rowCount)
    const { handle } = await this[kAdapter].query(query, ids, 'objects')
    // SQLite: handle.changes contains affected row count
    // PostgreSQL: handle may have rowCount
    return handle?.changes ?? handle?.rowCount ?? 0
  }

  /**
   * Update multiple rows by IDs with the same values (batch update).
   * @param {string} table - Table name.
   * @param {any[]} ids - Array of IDs to update.
   * @param {object} values - Values to set on all matching rows.
   * @param {string} [idColumn='id'] - ID column name.
   * @returns {Promise<number>} Number of rows updated.
   */
  async updateMany(table, ids, values, idColumn = 'id') {
    if (this[kClosed]) {
      throw new SQLConnectionClosedError()
    }
    validateString(table, 'table')
    validateString(idColumn, 'idColumn')
    validateObject(values, 'values')
    if (!ArrayIsArray(ids) || ids.length === 0) {
      throw new ERR_INVALID_ARG_VALUE('ids', ids, 'must be a non-empty array')
    }

    const paramStyle = this[kAdapter].paramStyle
    const cols = ObjectKeys(values)
    if (cols.length === 0) {
      throw new ERR_INVALID_ARG_VALUE(
        'values',
        values,
        'must have at least one column',
      )
    }

    // Build SET clause
    const setClauses = []
    const allValues = []
    let paramIndex = 1

    for (let i = 0, colsLen = cols.length; i < colsLen; i++) {
      const col = cols[i]
      if (paramStyle === '$') {
        ArrayPrototypePush(
          setClauses,
          `${escapeIdentifier(col)} = $${paramIndex++}`,
        )
      } else {
        ArrayPrototypePush(setClauses, `${escapeIdentifier(col)} = ?`)
      }
      ArrayPrototypePush(allValues, values[col])
    }

    // Build WHERE IN clause for IDs
    const idPlaceholders = []
    for (let i = 0, idsLen = ids.length; i < idsLen; i++) {
      if (paramStyle === '$') {
        ArrayPrototypePush(idPlaceholders, `$${paramIndex++}`)
      } else {
        ArrayPrototypePush(idPlaceholders, '?')
      }
      ArrayPrototypePush(allValues, ids[i])
    }

    const query = `UPDATE ${escapeIdentifier(table)} SET ${ArrayPrototypeJoin(setClauses, ', ')} WHERE ${escapeIdentifier(idColumn)} IN (${ArrayPrototypeJoin(idPlaceholders, ', ')})`
    // Use adapter.query directly to access handle metadata (changes/rowCount)
    const { handle } = await this[kAdapter].query(query, allValues, 'objects')
    // SQLite: handle.changes contains affected row count
    // PostgreSQL: handle may have rowCount
    return handle?.changes ?? handle?.rowCount ?? 0
  }

  /**
   * Create an identifier fragment (table/column name).
   * @param {string|string[]} name
   * @returns {SQLFragment}
   */
  static identifier(name) {
    if (ArrayIsArray(name)) {
      const escaped = ArrayPrototypeMap(name, escapeIdentifier)
      return new SQLFragment(ArrayPrototypeJoin(escaped, ', '))
    }
    return new SQLFragment(escapeIdentifier(name))
  }

  /**
   * Create an array literal (PostgreSQL).
   * @param {any[]} values
   * @returns {SQLFragment}
   */
  static array(values) {
    if (!ArrayIsArray(values)) {
      throw new ERR_INVALID_ARG_TYPE('values', 'Array', values)
    }
    // PostgreSQL ARRAY syntax.
    const escaped = ArrayPrototypeMap(values, v => {
      if (typeof v === 'string') {
        return `'${StringPrototypeReplace(v, SQL_SINGLE_QUOTE_REGEX, "''")}'`
      }
      return StringCtor(v)
    })
    return new SQLFragment(`ARRAY[${ArrayPrototypeJoin(escaped, ', ')}]`)
  }

  /**
   * Create a JSON value.
   * Escapes single quotes to prevent SQL injection.
   * @param {any} value
   * @returns {SQLFragment}
   */
  static json(value) {
    const jsonStr = JSONStringify(value)
    // Escape single quotes for SQL string literal safety.
    const escaped = StringPrototypeReplace(
      jsonStr,
      SQL_SINGLE_QUOTE_REGEX,
      "''",
    )
    return new SQLFragment(`'${escaped}'::jsonb`)
  }
}

// Also expose sql() as a function for creating identifiers inline.
function sqlHelper(value, ...columns) {
  // sql('tableName') - identifier
  if (typeof value === 'string') {
    return SQL.identifier(value)
  }

  // sql(['col1', 'col2']) - multiple identifiers
  if (ArrayIsArray(value)) {
    if (
      value.length > 0 &&
      typeof value[0] === 'object' &&
      value[0] !== null &&
      !ArrayIsArray(value[0])
    ) {
      // sql([{a: 1}, {a: 2}]) - bulk insert values
      return buildInsertQuery(value, columns.length > 0 ? columns : undefined)
    }
    return SQL.identifier(value)
  }

  // sql(object, 'col1', 'col2') - insert with specific columns
  if (typeof value === 'object' && value !== null) {
    return buildInsertQuery([value], columns.length > 0 ? columns : undefined)
  }

  throw new ERR_INVALID_ARG_TYPE('value', ['string', 'Array', 'object'], value)
}

/**
 * ReservedConnection - An exclusive connection from the pool.
 */
class ReservedConnection {
  #adapter
  #conn
  #released = false

  constructor(adapter, conn) {
    this.#adapter = adapter
    this.#conn = conn

    // Return callable proxy for tagged template support.
    const self = this
    const handler = {
      __proto__: null,
      apply(target, thisArg, args) {
        return ReflectApply(self.#taggedTemplate, self, args)
      },
      get(target, prop, receiver) {
        // Use ObjectHasOwn to prevent prototype pollution attacks.
        if (
          ObjectHasOwn(self, prop) ||
          ObjectHasOwn(ReservedConnection.prototype, prop)
        ) {
          const value = self[prop]
          if (typeof value === 'function') {
            return FunctionPrototypeBind(value, self)
          }
          return value
        }
        return undefined
      },
    }

    // eslint-disable-next-line no-constructor-return
    return new Proxy(function ReservedTaggedTemplate() {}, handler)
  }

  #taggedTemplate(strings, ...values) {
    if (this.#released) {
      throw new SQLConnectionClosedError()
    }

    // Use template cache for performance (separate cache per paramStyle)
    const paramStyle = this.#adapter.paramStyle
    const templateCache = getTemplateCache(paramStyle)
    let cached = WeakMapPrototypeGet(templateCache, strings)
    if (!cached) {
      cached = parseQuery(strings, paramStyle)
      WeakMapPrototypeSet(templateCache, strings, cached)
    }

    // Use for loop instead of map for hot-path performance
    const { text, paramIndices } = cached
    const paramLen = paramIndices.length
    const queryValues = new Array(paramLen)
    for (let i = 0; i < paramLen; i++) {
      queryValues[i] = values[paramIndices[i]]
    }

    return new SQLQuery(this.#adapter, text, queryValues)
  }

  /**
   * Release the connection back to the pool.
   */
  release() {
    if (!this.#released) {
      this.#released = true
      this.#adapter.releaseConnection(this.#conn)
    }
  }
}

ObjectDefineProperty(ReservedConnection.prototype, SymbolToStringTag, {
  __proto__: null,
  configurable: true,
  value: 'ReservedConnection',
})

/**
 * Build row placeholders and values for multi-row INSERT/UPSERT operations.
 * Extracted to eliminate duplication between insertMany and upsertMany.
 * @param {object[]} rows - Array of row objects
 * @param {string[]} cols - Column names
 * @param {string} paramStyle - Parameter placeholder style ('$' or '?')
 * @returns {{rowPlaceholders: string[], allValues: any[]}}
 */
function buildRowPlaceholders(rows, cols, paramStyle) {
  const colsLen = cols.length
  const rowPlaceholders = []
  const allValues = []

  if (paramStyle === '$') {
    // PostgreSQL: needs incrementing $1, $2, ... for each value
    let paramIndex = 1
    for (let i = 0, rowsLen = rows.length; i < rowsLen; i++) {
      const row = rows[i]
      const placeholders = []
      for (let j = 0; j < colsLen; j++) {
        ArrayPrototypePush(placeholders, `$${paramIndex++}`)
        ArrayPrototypePush(allValues, row[cols[j]])
      }
      ArrayPrototypePush(
        rowPlaceholders,
        `(${ArrayPrototypeJoin(placeholders, ', ')})`,
      )
    }
  } else {
    // SQLite: all rows use same placeholder pattern (?, ?, ...)
    // Pre-compute template once, reuse for all rows
    const placeholderTemplate = []
    for (let j = 0; j < colsLen; j++) {
      ArrayPrototypePush(placeholderTemplate, '?')
    }
    const singleRowPlaceholder = `(${ArrayPrototypeJoin(placeholderTemplate, ', ')})`

    for (let i = 0, rowsLen = rows.length; i < rowsLen; i++) {
      const row = rows[i]
      for (let j = 0; j < colsLen; j++) {
        ArrayPrototypePush(allValues, row[cols[j]])
      }
      ArrayPrototypePush(rowPlaceholders, singleRowPlaceholder)
    }
  }

  return { __proto__: null, rowPlaceholders, allValues }
}

// Default SQL instance using environment variables.
let defaultSQL
function getDefaultSQL() {
  defaultSQL ??= new SQL()
  return defaultSQL
}

// Default tagged template function.
function sql(strings, ...values) {
  return getDefaultSQL()(strings, ...values)
}

// Attach static methods to sql function.
ObjectDefineProperties(sql, {
  __proto__: null,
  array: { __proto__: null, value: SQL.array, enumerable: true },
  json: { __proto__: null, value: SQL.json, enumerable: true },
  identifier: { __proto__: null, value: SQL.identifier, enumerable: true },
})

module.exports = {
  __proto__: null,
  SQL,
  sql,
  SQLQuery,
  SQLFragment,
  SQLError,
  PostgresError,
  SQLiteError,
  SQLConnectionClosedError,
  SQLTransactionCommittedError,
  SQLTransactionRolledBackError,
  SQLTransactionNotStartedError,
  ReservedConnection,
  Transaction,
  Savepoint,
  // Constants
  IsolationLevel,
  PG_ERROR_CODES,
  SQLITE_ERROR_CODES,
  // Error type guards
  isUniqueViolation,
  isForeignKeyViolation,
  isNotNullViolation,
  isCheckViolation,
  isConnectionError,
  isSyntaxError,
  isUndefinedTable,
}
