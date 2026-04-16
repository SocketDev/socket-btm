'use strict'

// SQL Query Parsing and Building
// Handles tagged template to parameterized query conversion.

const {
  ArrayIsArray,
  ArrayPrototypeJoin,
  ArrayPrototypeMap,
  ArrayPrototypePush,
  MathImul,
  NumberPrototypeToString,
  ObjectKeys,
  SafeWeakMap,
  StringPrototypeCharCodeAt,
  StringPrototypeReplace,
  hardenRegExp,
} = primordials

// Global template caches for parsed queries (shared across SQL instances and transactions)
// Uses separate WeakMaps per paramStyle to avoid collision between PostgreSQL ($1, $2) and SQLite (?, ?)
// WeakMap with template strings array as key for automatic garbage collection
const templateCachePostgres = new SafeWeakMap()
const templateCacheSqlite = new SafeWeakMap()

/**
 * Get the appropriate template cache for the given param style.
 * @param {'$'|'?'} paramStyle - Parameter placeholder style
 * @returns {WeakMap} - The cache for this style
 */
function getTemplateCache(paramStyle) {
  return paramStyle === '$' ? templateCachePostgres : templateCacheSqlite
}

const {
  codes: { ERR_INVALID_ARG_TYPE },
} = require('internal/errors')

// Pre-compiled regex for escape operations (performance optimization).
const DOUBLE_QUOTE_REGEX = hardenRegExp(/"/g)

/**
 * Parse a tagged template into a parameterized query.
 *
 * Performance optimizations:
 * 1. Single pass through template strings
 * 2. Avoid regex where possible
 * 3. Pre-allocate result arrays
 * 4. Use character codes for comparisons
 *
 * @param {TemplateStringsArray} strings - Template literal strings array
 * @param {'$'|'?'} paramStyle - Parameter placeholder style
 * @returns {{ text: string, paramIndices: number[] }}
 */
function parseQuery(strings, paramStyle = '$') {
  const len = strings.length
  if (len === 1) {
    // No interpolations - return as-is.
    return { __proto__: null, text: strings[0], paramIndices: [] }
  }

  const parts = new Array(len * 2 - 1)
  const paramIndices = new Array(len - 1)

  for (let i = 0; i < len - 1; i++) {
    parts[i * 2] = strings[i]
    if (paramStyle === '$') {
      // PostgreSQL: $1, $2, $3, ...
      parts[i * 2 + 1] = `$${i + 1}`
    } else {
      // SQLite: ?, ?, ?, ...
      parts[i * 2 + 1] = '?'
    }
    paramIndices[i] = i
  }
  parts[(len - 1) * 2] = strings[len - 1]

  return {
    __proto__: null,
    text: ArrayPrototypeJoin(parts, ''),
    paramIndices,
  }
}

/**
 * Escape a SQL identifier (table/column name).
 * Prevents SQL injection for dynamic identifiers.
 *
 * @param {string} name - Identifier to escape
 * @returns {string} - Escaped identifier
 */
function escapeIdentifier(name) {
  if (typeof name !== 'string') {
    throw new ERR_INVALID_ARG_TYPE('name', 'string', name)
  }

  // Replace double quotes with escaped double quotes.
  const escaped = StringPrototypeReplace(name, DOUBLE_QUOTE_REGEX, '""')
  return `"${escaped}"`
}

/**
 * Build an INSERT query from objects.
 * Supports both single and bulk inserts.
 *
 * @param {object[]} rows - Array of row objects
 * @param {string[]} [columns] - Specific columns to include
 * @returns {SQLFragment}
 */
function buildInsertQuery(rows, columns) {
  if (!ArrayIsArray(rows) || rows.length === 0) {
    throw new ERR_INVALID_ARG_TYPE('rows', 'non-empty Array', rows)
  }

  // Determine columns from first row or explicit list.
  const cols = columns ?? ObjectKeys(rows[0])
  const colCount = cols.length

  // Build column list.
  const escapedCols = ArrayPrototypeMap(cols, escapeIdentifier)
  const columnList = `(${ArrayPrototypeJoin(escapedCols, ', ')})`

  // Build value placeholders.
  const values = []
  const valueSets = []
  let paramIndex = 1

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const placeholders = new Array(colCount)

    for (let j = 0; j < colCount; j++) {
      placeholders[j] = `$${paramIndex++}`
      ArrayPrototypePush(values, row[cols[j]])
    }

    ArrayPrototypePush(valueSets, `(${ArrayPrototypeJoin(placeholders, ', ')})`)
  }

  const text = `${columnList} VALUES ${ArrayPrototypeJoin(valueSets, ', ')}`

  // Return a SQLFragment-like object.
  return {
    __proto__: null,
    text,
    values,
    toString() {
      return text
    },
  }
}

/**
 * Hash a query string for prepared statement naming.
 * Uses FNV-1a hash for speed and good distribution.
 *
 * @param {string} query - Query string to hash
 * @returns {string} - Hex hash string
 */
function hashQuery(query) {
  // FNV-1a hash (32-bit).
  let hash = 0x811c9dc5
  for (let i = 0; i < query.length; i++) {
    hash ^= StringPrototypeCharCodeAt(query, i)
    // Multiply by FNV prime using MathImul for faster 32-bit multiplication.
    hash = MathImul(hash, 0x01000193) >>> 0
  }
  return NumberPrototypeToString(hash, 16)
}

module.exports = {
  __proto__: null,
  getTemplateCache,
  parseQuery,
  escapeIdentifier,
  buildInsertQuery,
  hashQuery,
}
