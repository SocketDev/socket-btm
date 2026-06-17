/**
 * @fileoverview Verify-build tests for node:smol-sql.
 *
 * Locks the public API surface from
 * additions/source-patched/lib/smol-sql.js — 28 named exports plus a
 * `default` aliased to `sql` (Bun-compat).
 */

import { describe, expect, it } from 'vitest'

import {
  parseExportShape,
  printExportShapeScript,
  runOnSmolBinary,
  smolBuiltinIsAvailable,
} from '../helpers/smol-builtin.mts'

const skipTests = !smolBuiltinIsAvailable('smol-sql')

const EXPECTED_EXPORTS: ReadonlyArray<readonly [string, string]> = [
  ['IsolationLevel', 'object'],
  ['PG_ERROR_CODES', 'object'],
  ['PostgresError', 'function'],
  ['ReservedConnection', 'function'],
  ['SQL', 'function'],
  ['SQLConnectionClosedError', 'function'],
  ['SQLError', 'function'],
  ['SQLFragment', 'function'],
  ['SQLITE_ERROR_CODES', 'object'],
  ['SQLQuery', 'function'],
  ['SQLTransactionCommittedError', 'function'],
  ['SQLTransactionRolledBackError', 'function'],
  ['SQLiteError', 'function'],
  ['Savepoint', 'function'],
  ['Transaction', 'function'],
  ['default', 'function'],
  ['isCheckViolation', 'function'],
  ['isConnectionError', 'function'],
  ['isForeignKeyViolation', 'function'],
  ['isNotNullViolation', 'function'],
  ['isSyntaxError', 'function'],
  ['isUndefinedTable', 'function'],
  ['isUniqueViolation', 'function'],
  ['sql', 'function'],
]

describe.skipIf(skipTests)('node:smol-sql integration', () => {
  it("isBuiltin('node:smol-sql') returns true; bare 'smol-sql' returns false (schemelessBlockList)", async () => {
    const script = `
      const { isBuiltin } = require('node:module')
      console.log('isBuiltin(node:smol-sql)=' + isBuiltin('node:smol-sql'))
      console.log('isBuiltin(smol-sql)=' + isBuiltin('smol-sql'))
    `
    const { code, stdout } = await runOnSmolBinary(script)
    expect(code).toBe(0)
    expect(stdout).toContain('isBuiltin(node:smol-sql)=true')
    expect(stdout).toContain('isBuiltin(smol-sql)=false')
  })

  it("builtinModules contains 'node:smol-sql' (prefixed form)", async () => {
    const script = `
      const { builtinModules } = require('node:module')
      console.log('contains-prefixed=' + builtinModules.includes('node:smol-sql'))
      console.log('contains-bare=' + builtinModules.includes('smol-sql'))
    `
    const { code, stdout } = await runOnSmolBinary(script)
    expect(code).toBe(0)
    expect(stdout).toContain('contains-prefixed=true')
    expect(stdout).toContain('contains-bare=false')
  })

  it('exports exactly the documented API surface (no drift)', async () => {
    const { code, stdout } = await runOnSmolBinary(
      printExportShapeScript('smol-sql'),
    )
    expect(code).toBe(0)
    const shape = parseExportShape(stdout)
    // oxlint-disable-next-line socket/prefer-cached-for-loop -- loop variable is destructured
    for (const [name, type] of EXPECTED_EXPORTS) {
      expect(shape.get(name), `export ${name}`).toBe(type)
    }
    const expectedNames = new Set(EXPECTED_EXPORTS.map(([n]) => n))
    const unexpected = [...shape.keys()].filter(n => !expectedNames.has(n))
    expect(unexpected).toEqual([])
  })

  it('`default` aliases `sql` (Bun-compat)', async () => {
    const script = `
      const m = require('node:smol-sql')
      console.log('default-is-sql=' + (m.default === m.sql))
    `
    const { code, stdout } = await runOnSmolBinary(script)
    expect(code).toBe(0)
    expect(stdout).toContain('default-is-sql=true')
  })

  it('error-class hierarchy: subclasses extend SQLError', async () => {
    const script = `
      const m = require('node:smol-sql')
      const subs = ['PostgresError', 'SQLiteError', 'SQLConnectionClosedError', 'SQLTransactionCommittedError', 'SQLTransactionRolledBackError']
      for (const n of subs) {
        const e = Object.create(m[n].prototype)
        console.log(n + '-extends-SQLError=' + (e instanceof m.SQLError))
      }
    `
    const { code, stdout } = await runOnSmolBinary(script)
    expect(code).toBe(0)
    expect(stdout).toContain('PostgresError-extends-SQLError=true')
    expect(stdout).toContain('SQLiteError-extends-SQLError=true')
    expect(stdout).toContain('SQLConnectionClosedError-extends-SQLError=true')
    expect(stdout).toContain(
      'SQLTransactionCommittedError-extends-SQLError=true',
    )
    expect(stdout).toContain(
      'SQLTransactionRolledBackError-extends-SQLError=true',
    )
  })

  it('module exports are frozen and null-prototype', async () => {
    const script = `
      const m = require('node:smol-sql')
      console.log('frozen=' + Object.isFrozen(m))
      console.log('proto=' + Object.getPrototypeOf(m))
    `
    const { code, stdout } = await runOnSmolBinary(script)
    expect(code).toBe(0)
    expect(stdout).toContain('frozen=true')
    expect(stdout).toContain('proto=null')
  })

  it('rejects bare `smol-sql` with MODULE_NOT_FOUND (must use node: prefix)', async () => {
    const script = `
      try {
        require('smol-sql')
        console.log('UNEXPECTED-LOAD')
      } catch (e) {
        console.log('blocked-code=' + (e.code || 'no-code'))
      }
    `
    const { code, stdout } = await runOnSmolBinary(script)
    expect(code).toBe(0)
    expect(stdout).not.toContain('UNEXPECTED-LOAD')
    expect(stdout).toContain('blocked-code=MODULE_NOT_FOUND')
  })
})
