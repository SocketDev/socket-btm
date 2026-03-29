'use strict';

// node:smol-sql - Unified SQL API
// High-performance, Bun-compatible SQL interface for PostgreSQL and SQLite.
//
// Usage:
//   import { sql, SQL } from 'node:smol-sql';
//
//   // Default instance (uses POSTGRES_URL or DATABASE_URL env var)
//   const users = await sql`SELECT * FROM users WHERE id = ${1}`;
//
//   // Explicit PostgreSQL connection
//   const pg = new SQL('postgres://user:pass@localhost:5432/mydb');
//
//   // SQLite (in-memory or file)
//   const db = new SQL(':memory:');
//   const fileDb = new SQL('sqlite://./data.db');
//
//   // Transactions
//   await pg.begin(async tx => {
//     await tx`INSERT INTO users (name) VALUES (${'Alice'})`;
//     await tx`UPDATE accounts SET balance = balance - 100`;
//   });

const {
  ObjectFreeze,
} = primordials;

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
} = require('internal/socketsecurity/sql/client');

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
});
