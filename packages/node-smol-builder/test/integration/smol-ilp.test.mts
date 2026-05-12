/**
 * @fileoverview Verify-build tests for node:smol-ilp.
 *
 * Locks the public API surface from additions/source-patched/lib/smol-ilp.js:
 *   - `Sender`, `BulkRowBuilder` classes
 *   - `TimeUnit` enum (Nanoseconds=0, Microseconds=1, Milliseconds=2, Seconds=3)
 *   - `ILPError` constructor
 *   - `ErrorCodes` constant object
 *   - `default` aliased to `Sender`
 */

import {
  parseExportShape,
  printExportShapeScript,
  runOnSmolBinary,
  smolBuiltinIsAvailable,
} from '../helpers/smol-builtin.mts'

const skipTests = !smolBuiltinIsAvailable('smol-ilp')

const EXPECTED_EXPORTS: ReadonlyArray<readonly [string, string]> = [
  ['BulkRowBuilder', 'function'],
  ['ErrorCodes', 'object'],
  ['ILPError', 'function'],
  ['Sender', 'function'],
  ['TimeUnit', 'object'],
  ['default', 'function'],
]

describe.skipIf(skipTests)('node:smol-ilp integration', () => {
  it("isBuiltin('node:smol-ilp') returns true; bare 'smol-ilp' returns false (schemelessBlockList)", async () => {
    const script = `
      const { isBuiltin } = require('node:module')
      console.log('isBuiltin(node:smol-ilp)=' + isBuiltin('node:smol-ilp'))
      console.log('isBuiltin(smol-ilp)=' + isBuiltin('smol-ilp'))
    `
    const { code, stdout } = await runOnSmolBinary(script)
    expect(code).toBe(0)
    expect(stdout).toContain('isBuiltin(node:smol-ilp)=true')
    expect(stdout).toContain('isBuiltin(smol-ilp)=false')
  })

  it("builtinModules contains 'node:smol-ilp' (prefixed form)", async () => {
    const script = `
      const { builtinModules } = require('node:module')
      console.log('contains-prefixed=' + builtinModules.includes('node:smol-ilp'))
      console.log('contains-bare=' + builtinModules.includes('smol-ilp'))
    `
    const { code, stdout } = await runOnSmolBinary(script)
    expect(code).toBe(0)
    expect(stdout).toContain('contains-prefixed=true')
    expect(stdout).toContain('contains-bare=false')
  })

  it('exports exactly the documented API surface (no drift)', async () => {
    const { code, stdout } = await runOnSmolBinary(
      printExportShapeScript('smol-ilp'),
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

  it('TimeUnit enum has documented numeric values', async () => {
    const script = `
      const { TimeUnit } = require('node:smol-ilp')
      console.log('Nanoseconds=' + TimeUnit.Nanoseconds)
      console.log('Microseconds=' + TimeUnit.Microseconds)
      console.log('Milliseconds=' + TimeUnit.Milliseconds)
      console.log('Seconds=' + TimeUnit.Seconds)
    `
    const { code, stdout } = await runOnSmolBinary(script)
    expect(code).toBe(0)
    expect(stdout).toContain('Nanoseconds=0')
    expect(stdout).toContain('Microseconds=1')
    expect(stdout).toContain('Milliseconds=2')
    expect(stdout).toContain('Seconds=3')
  })

  it('ErrorCodes contains documented error codes', async () => {
    const script = `
      const { ErrorCodes } = require('node:smol-ilp')
      const expected = ['CLOSED', 'CONNECTION_FAILED', 'NOT_CONNECTED', 'NO_TABLE', 'FLUSH_FAILED', 'BUFFER_OVERFLOW']
      for (const k of expected) {
        console.log('has-' + k + '=' + (k in ErrorCodes))
      }
    `
    const { code, stdout } = await runOnSmolBinary(script)
    expect(code).toBe(0)
    expect(stdout).toContain('has-CLOSED=true')
    expect(stdout).toContain('has-CONNECTION_FAILED=true')
    expect(stdout).toContain('has-NOT_CONNECTED=true')
    expect(stdout).toContain('has-NO_TABLE=true')
    expect(stdout).toContain('has-FLUSH_FAILED=true')
    expect(stdout).toContain('has-BUFFER_OVERFLOW=true')
  })

  it('`default` aliases `Sender`', async () => {
    const script = `
      const ilp = require('node:smol-ilp')
      console.log('default-is-Sender=' + (ilp.default === ilp.Sender))
    `
    const { code, stdout } = await runOnSmolBinary(script)
    expect(code).toBe(0)
    expect(stdout).toContain('default-is-Sender=true')
  })

  it('module exports are frozen and null-prototype', async () => {
    const script = `
      const ilp = require('node:smol-ilp')
      console.log('frozen=' + Object.isFrozen(ilp))
      console.log('proto=' + Object.getPrototypeOf(ilp))
    `
    const { code, stdout } = await runOnSmolBinary(script)
    expect(code).toBe(0)
    expect(stdout).toContain('frozen=true')
    expect(stdout).toContain('proto=null')
  })

  it('rejects bare `smol-ilp` with MODULE_NOT_FOUND (must use node: prefix)', async () => {
    const script = `
      try {
        require('smol-ilp')
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
