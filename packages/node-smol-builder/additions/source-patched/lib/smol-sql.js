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
  ReservedConnection,
  Transaction,
  Savepoint,
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
  ReservedConnection,
  Transaction,
  Savepoint,

  // Bun compatibility: sql and SQL are the primary exports.
  default: sql,
})
