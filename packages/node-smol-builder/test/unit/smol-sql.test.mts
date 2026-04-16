/**
 * @fileoverview Tests for node:smol-sql testable components.
 *
 * The node:smol-sql module only works inside SEA. This file tests TypeScript
 * type definitions since the runtime code requires Node.js internals.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

describe('node:smol-sql TypeScript definitions', () => {
  const typingsPath = join(
    __dirname,
    '../../additions/source-patched/typings/node_smol-sql.d.ts',
  )
  let content: string

  beforeAll(() => {
    content = readFileSync(typingsPath, 'utf8')
  })

  describe('Core SQL classes', () => {
    it('exports SQL main class', () => {
      expect(content).toContain('export class SQL')
      expect(content).toContain(
        'constructor(urlOrOptions?: string | SQLOptions',
      )
    })

    it('exports SQLQuery class with promise-like API', () => {
      expect(content).toContain('export class SQLQuery')
      expect(content).toContain('then<TResult1')
      expect(content).toContain('values(): Promise<any[][]>')
      expect(content).toContain('raw(): Promise<Buffer[][]>')
      expect(content).toContain('stream(): AsyncIterable<T>')
    })

    it('exports SQLFragment for safe identifiers', () => {
      expect(content).toContain('export class SQLFragment')
      expect(content).toContain('readonly text: string')
      expect(content).toContain('readonly values: any[]')
    })

    it('exports default sql instance', () => {
      expect(content).toContain('export const sql: SQL')
    })
  })

  describe('Error classes', () => {
    it('exports base SQLError class', () => {
      expect(content).toContain('export class SQLError extends Error')
      expect(content).toContain('code?: string')
    })

    it('exports PostgresError with detailed fields', () => {
      expect(content).toContain('export class PostgresError extends SQLError')
      expect(content).toContain('severity?: string')
      expect(content).toContain('detail?: string')
      expect(content).toContain('constraint?: string')
    })

    it('exports SQLiteError', () => {
      expect(content).toContain('export class SQLiteError extends SQLError')
      expect(content).toContain('errcode?: number')
    })

    it('exports connection state errors', () => {
      expect(content).toContain(
        'export class SQLConnectionClosedError extends SQLError',
      )
      expect(content).toContain(
        'export class SQLTransactionCommittedError extends SQLError',
      )
      expect(content).toContain(
        'export class SQLTransactionRolledBackError extends SQLError',
      )
    })
  })

  describe('Error codes', () => {
    it('exports PostgreSQL error codes', () => {
      expect(content).toContain('export const PG_ERROR_CODES')
      expect(content).toContain('UNIQUE_VIOLATION')
      expect(content).toContain('FOREIGN_KEY_VIOLATION')
      expect(content).toContain('NOT_NULL_VIOLATION')
      expect(content).toContain('SYNTAX_ERROR')
    })

    it('exports SQLite error codes', () => {
      expect(content).toContain('export const SQLITE_ERROR_CODES')
      expect(content).toContain('SQLITE_OK: 0')
      expect(content).toContain('SQLITE_ERROR: 1')
      expect(content).toContain('SQLITE_CONSTRAINT: 19')
    })
  })

  describe('Transaction support', () => {
    it('exports Transaction class', () => {
      expect(content).toContain('export class Transaction')
      expect(content).toContain('begin(): Promise<void>')
      expect(content).toContain('commit(): Promise<void>')
      expect(content).toContain('rollback(): Promise<void>')
      expect(content).toContain('savepoint')
    })

    it('exports Savepoint class', () => {
      expect(content).toContain('export class Savepoint')
      expect(content).toContain('release(): Promise<void>')
      expect(content).toContain('rollback(): Promise<void>')
    })

    it('exports IsolationLevel constants', () => {
      expect(content).toContain('export const IsolationLevel')
      expect(content).toContain('READ_UNCOMMITTED')
      expect(content).toContain('READ_COMMITTED')
      expect(content).toContain('REPEATABLE_READ')
      expect(content).toContain('SERIALIZABLE')
    })
  })

  describe('Error type guards', () => {
    it('exports database-agnostic error guards', () => {
      expect(content).toContain(
        'export function isUniqueViolation(err: Error): boolean',
      )
      expect(content).toContain(
        'export function isForeignKeyViolation(err: Error): boolean',
      )
      expect(content).toContain(
        'export function isNotNullViolation(err: Error): boolean',
      )
      expect(content).toContain(
        'export function isCheckViolation(err: Error): boolean',
      )
    })

    it('exports connection and query error guards', () => {
      expect(content).toContain(
        'export function isConnectionError(err: Error): boolean',
      )
      expect(content).toContain(
        'export function isSyntaxError(err: Error): boolean',
      )
      expect(content).toContain(
        'export function isUndefinedTable(err: Error): boolean',
      )
    })
  })

  describe('Convenience methods', () => {
    it('provides findById helper', () => {
      expect(content).toContain('findById<T')
      expect(content).toContain('table: string')
      expect(content).toContain('id: any')
      expect(content).toContain('idColumn?: string')
    })

    it('provides batch insert methods', () => {
      expect(content).toContain('insertMany<T')
      expect(content).toContain('rows: Record<string, any>[]')
    })

    it('provides upsert methods', () => {
      expect(content).toContain('upsert<T')
      expect(content).toContain('upsertMany<T')
      expect(content).toContain('conflictColumns: string[]')
    })

    it('provides batch update/delete methods', () => {
      expect(content).toContain('updateMany')
      expect(content).toContain('deleteMany')
      expect(content).toContain('ids: any[]')
    })
  })

  describe('SQLQuery result methods', () => {
    it('provides first() and last() helpers', () => {
      expect(content).toContain('first(): Promise<T | undefined>')
      expect(content).toContain('last(): Promise<T | undefined>')
    })

    it('provides exists() and count() helpers', () => {
      expect(content).toContain('exists(): Promise<boolean>')
      expect(content).toContain('count(): Promise<number>')
    })

    it('provides take() for limiting results', () => {
      expect(content).toContain('take(n: number): Promise<T[]>')
    })

    it('provides getQuery() for introspection', () => {
      expect(content).toContain('getQuery()')
      expect(content).toContain('text: string')
      expect(content).toContain('values: any[]')
      expect(content).toContain('paramCount: number')
    })
  })

  describe('SQL builder methods', () => {
    it('provides identifier() for safe table/column names', () => {
      expect(content).toContain(
        'identifier(name: string | string[]): SQLFragment',
      )
    })

    it('provides array() for PostgreSQL arrays', () => {
      expect(content).toContain('array(values: any[]): SQLFragment')
    })

    it('provides json() for JSON values', () => {
      expect(content).toContain('json(value: any): SQLFragment')
    })
  })
})

describe('node:smol-sql documentation', () => {
  const typingsPath = join(
    __dirname,
    '../../additions/source-patched/typings/node_smol-sql.d.ts',
  )
  let content: string

  beforeAll(() => {
    content = readFileSync(typingsPath, 'utf8')
  })

  it('includes JSDoc examples for main SQL class', () => {
    expect(content).toContain('@example')
    expect(content).toContain('const db = new SQL')
  })

  it('documents transaction usage', () => {
    expect(content).toContain('await sql.begin(async (tx) => {')
  })

  it('documents tagged template usage', () => {
    expect(content).toContain('sql`SELECT')
  })
})

describe('Runtime code (not testable outside SEA)', () => {
  it.skip('format-detection.js requires Node.js primordials', () => {
    // The format-detection.js file uses primordials which are only available in Node.js internals
  })

  it.skip('version-subset.js requires Node.js primordials', () => {
    // The version-subset.js file uses primordials which are only available in Node.js internals
  })

  it.skip('errors.js requires Node.js primordials', () => {
    // The errors.js file uses primordials and ErrorCaptureStackTrace which are Node.js internals
  })

  it.skip('SQL module can only be tested inside SEA binary', () => {
    // The complete node:smol-sql module is designed to work inside the Single Executable Application
    // and cannot be imported directly in Jest tests
  })
})
