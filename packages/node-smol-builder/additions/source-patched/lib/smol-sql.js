'use strict'

// Documentation: docs/additions/lib/smol-sql.js.md

const { ObjectFreeze } = primordials

const {
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
  ReservedConnection,
  Transaction,
  Savepoint,
  IsolationLevel,
  PG_ERROR_CODES,
  SQLITE_ERROR_CODES,
  isUniqueViolation,
  isForeignKeyViolation,
  isNotNullViolation,
  isCheckViolation,
  isConnectionError,
  isSyntaxError,
  isUndefinedTable,
} = require('internal/socketsecurity/sql/client')

module.exports = ObjectFreeze({
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

  // Bun compatibility: sql and SQL are the primary exports.
  default: sql,
})
