/**
 * @fileoverview Verify-build tests for node:smol-ffi.
 *
 * Locks the public API surface documented in
 * additions/source-patched/lib/smol-ffi.js: 33 named exports + the
 * `default` export aliased to `open`. Each export is asserted by name
 * and `typeof`. Drift in either direction (added/removed/renamed)
 * fails the suite.
 *
 * Skips entirely if the Final/ binary doesn't have the smol_ffi
 * binding wired in.
 */

import {
  parseExportShape,
  printExportShapeScript,
  runOnSmolBinary,
  smolBuiltinIsAvailable,
} from '../helpers/smol-builtin.mts'

const skipTests = !smolBuiltinIsAvailable('smol-ffi')

const EXPECTED_EXPORTS: ReadonlyArray<readonly [string, string]> = [
  ['Library', 'function'],
  ['FFIError', 'function'],
  ['bufferToPtr', 'function'],
  ['default', 'function'],
  ['dlopen', 'function'],
  ['getFloat32', 'function'],
  ['getFloat64', 'function'],
  ['getInt16', 'function'],
  ['getInt32', 'function'],
  ['getInt64', 'function'],
  ['getInt8', 'function'],
  ['getUint16', 'function'],
  ['getUint32', 'function'],
  ['getUint64', 'function'],
  ['getUint8', 'function'],
  ['open', 'function'],
  ['ptrToArrayBuffer', 'function'],
  ['ptrToBuffer', 'function'],
  ['ptrToString', 'function'],
  ['setFloat32', 'function'],
  ['setFloat64', 'function'],
  ['setInt16', 'function'],
  ['setInt32', 'function'],
  ['setInt64', 'function'],
  ['setInt8', 'function'],
  ['setUint16', 'function'],
  ['setUint32', 'function'],
  ['setUint64', 'function'],
  ['setUint8', 'function'],
  ['suffix', 'string'],
  ['types', 'object'],
]

describe.skipIf(skipTests)('node:smol-ffi integration', () => {
  it("isBuiltin('node:smol-ffi') returns true; bare 'smol-ffi' returns false (schemelessBlockList)", async () => {
    const script = `
      const { isBuiltin } = require('node:module')
      console.log('isBuiltin(node:smol-ffi)=' + isBuiltin('node:smol-ffi'))
      console.log('isBuiltin(smol-ffi)=' + isBuiltin('smol-ffi'))
    `
    const { code, stdout } = await runOnSmolBinary(script)
    expect(code).toBe(0)
    expect(stdout).toContain('isBuiltin(node:smol-ffi)=true')
    expect(stdout).toContain('isBuiltin(smol-ffi)=false')
  })

  it("builtinModules contains 'node:smol-ffi' (prefixed form)", async () => {
    const script = `
      const { builtinModules } = require('node:module')
      console.log('contains-prefixed=' + builtinModules.includes('node:smol-ffi'))
      console.log('contains-bare=' + builtinModules.includes('smol-ffi'))
    `
    const { code, stdout } = await runOnSmolBinary(script)
    expect(code).toBe(0)
    expect(stdout).toContain('contains-prefixed=true')
    expect(stdout).toContain('contains-bare=false')
  })

  it('exports exactly the documented API surface (no drift)', async () => {
    const { code, stdout } = await runOnSmolBinary(
      printExportShapeScript('smol-ffi'),
    )
    expect(code).toBe(0)
    const shape = parseExportShape(stdout)
    for (const [name, type] of EXPECTED_EXPORTS) {
      expect(shape.get(name), `export ${name}`).toBe(type)
    }
    const expectedNames = new Set(EXPECTED_EXPORTS.map(([n]) => n))
    const unexpected = [...shape.keys()].filter(n => !expectedNames.has(n))
    expect(unexpected).toEqual([])
  })

  it("`default` aliases `open`", async () => {
    const script = `
      const ffi = require('node:smol-ffi')
      console.log('default-is-open=' + (ffi.default === ffi.open))
    `
    const { code, stdout } = await runOnSmolBinary(script)
    expect(code).toBe(0)
    expect(stdout).toContain('default-is-open=true')
  })

  it('module exports are frozen and null-prototype', async () => {
    const script = `
      const ffi = require('node:smol-ffi')
      console.log('frozen=' + Object.isFrozen(ffi))
      console.log('proto=' + Object.getPrototypeOf(ffi))
    `
    const { code, stdout } = await runOnSmolBinary(script)
    expect(code).toBe(0)
    expect(stdout).toContain('frozen=true')
    expect(stdout).toContain('proto=null')
  })

  it('rejects bare `smol-ffi` with MODULE_NOT_FOUND (must use node: prefix)', async () => {
    const script = `
      try {
        require('smol-ffi')
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
