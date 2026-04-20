'use strict'

// SQL Result Set Handling
// Provides consistent result formatting across adapters.

const {
  ArrayPrototypeMap,
  ArrayPrototypeSlice,
  Error: ErrorCtor,
  ObjectCreate,
  ObjectDefineProperty,
  ObjectFreeze,
  SafeSet,
  SetPrototypeAdd,
  SetPrototypeHas,
  Symbol: SymbolCtor,
  SymbolIterator,
  SymbolToStringTag,
} = primordials

const kRows = SymbolCtor('kRows')
const kColumns = SymbolCtor('kColumns')
const kRowCount = SymbolCtor('kRowCount')
const kCommand = SymbolCtor('kCommand')

/**
 * SQLResult - Represents a query result set.
 * Provides array-like access to rows with metadata.
 */
class SQLResult {
  [kRows];
  [kColumns];
  [kRowCount];
  [kCommand]

  /**
   * Create a new SQLResult.
   * @param {object[]} rows - Array of row objects
   * @param {object} metadata - Result metadata
   * @param {string[]} metadata.columns - Column names
   * @param {number} metadata.rowCount - Number of affected rows
   * @param {string} metadata.command - SQL command (SELECT, INSERT, etc.)
   */
  constructor(rows, metadata) {
    const meta = { __proto__: null, ...metadata }
    this[kRows] = rows
    this[kColumns] = meta.columns ?? []
    this[kRowCount] = meta.rowCount ?? rows.length
    this[kCommand] = meta.command ?? ''

    // Make result array-like.
    for (let i = 0, len = rows.length; i < len; i++) {
      this[i] = rows[i]
    }
  }

  /**
   * Number of rows in result.
   * @returns {number}
   */
  get length() {
    return this[kRows].length
  }

  /**
   * Column names.
   * @returns {string[]}
   */
  get columns() {
    return this[kColumns]
  }

  /**
   * Number of rows affected by INSERT/UPDATE/DELETE.
   * @returns {number}
   */
  get rowCount() {
    return this[kRowCount]
  }

  /**
   * SQL command type.
   * @returns {string}
   */
  get command() {
    return this[kCommand]
  }

  /**
   * Iterator support.
   */
  [SymbolIterator]() {
    return this[kRows][SymbolIterator]()
  }

  /**
   * Map over rows.
   * @param {function} fn - Mapping function
   * @returns {any[]}
   */
  map(fn) {
    return ArrayPrototypeMap(this[kRows], fn)
  }

  /**
   * Convert to plain array.
   * @returns {object[]}
   */
  toArray() {
    return ArrayPrototypeSlice(this[kRows])
  }
}

ObjectDefineProperty(SQLResult.prototype, SymbolToStringTag, {
  __proto__: null,
  configurable: true,
  value: 'SQLResult',
})

/**
 * Convert raw result rows to objects.
 * @param {any[][]} rows - Array of value arrays
 * @param {string[]} columns - Column names
 * @returns {object[]}
 */
function rowsToObjects(rows, columns) {
  const len = rows.length
  const colLen = columns.length
  const result = new Array(len)

  // Duplicate column names (e.g. `SELECT a.id, b.id FROM a JOIN b …`) would
  // silently overwrite earlier values. Reject early so the caller gets a
  // loud error instead of wrong-joined data.
  const seen = new SafeSet()
  for (let j = 0; j < colLen; j++) {
    if (SetPrototypeHas(seen, columns[j])) {
      throw new ErrorCtor(
        `Duplicate column name in result: "${columns[j]}". ` +
          'Alias columns (e.g. `a.id AS a_id, b.id AS b_id`) to disambiguate.',
      )
    }
    SetPrototypeAdd(seen, columns[j])
  }

  for (let i = 0; i < len; i++) {
    const row = rows[i]
    const obj = ObjectCreate(null)
    for (let j = 0; j < colLen; j++) {
      obj[columns[j]] = row[j]
    }
    result[i] = obj
  }

  return result
}

module.exports = {
  __proto__: null,
  SQLResult,
  rowsToObjects,
}
