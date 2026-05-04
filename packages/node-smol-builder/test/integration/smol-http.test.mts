/**
 * @fileoverview Verify-build tests for node:smol-http.
 *
 * smol-http re-exports an internal barrel via `...httpModule`. Rather
 * than over-specify the surface here (which would duplicate the
 * barrel's internals and rot quickly), the suite locks the contract
 * the smol-https.js shim depends on — `serve` must exist as a
 * function — plus the standard isBuiltin/builtinModules/freeze/
 * null-prototype/no-bare-import invariants every smol-* module shares.
 */

import {
  parseExportShape,
  printExportShapeScript,
  runOnSmolBinary,
  smolBuiltinIsAvailable,
} from '../helpers/smol-builtin.mts'

const skipTests = !smolBuiltinIsAvailable('smol-http')

describe.skipIf(skipTests)('node:smol-http integration', () => {
  it("isBuiltin('node:smol-http') returns true; bare 'smol-http' returns false (schemelessBlockList)", async () => {
    const script = `
      const { isBuiltin } = require('node:module')
      console.log('isBuiltin(node:smol-http)=' + isBuiltin('node:smol-http'))
      console.log('isBuiltin(smol-http)=' + isBuiltin('smol-http'))
    `
    const { code, stdout } = await runOnSmolBinary(script)
    expect(code).toBe(0)
    expect(stdout).toContain('isBuiltin(node:smol-http)=true')
    expect(stdout).toContain('isBuiltin(smol-http)=false')
  })

  it("builtinModules contains 'node:smol-http' (prefixed form)", async () => {
    const script = `
      const { builtinModules } = require('node:module')
      console.log('contains-prefixed=' + builtinModules.includes('node:smol-http'))
      console.log('contains-bare=' + builtinModules.includes('smol-http'))
    `
    const { code, stdout } = await runOnSmolBinary(script)
    expect(code).toBe(0)
    expect(stdout).toContain('contains-prefixed=true')
    expect(stdout).toContain('contains-bare=false')
  })

  it('exports `serve` (contract smol-https depends on)', async () => {
    const { code, stdout } = await runOnSmolBinary(
      printExportShapeScript('smol-http'),
    )
    expect(code).toBe(0)
    const shape = parseExportShape(stdout)
    expect(shape.get('serve')).toBe('function')
    expect(shape.get('default')).toBe('object')
  })

  it('module exports are frozen and null-prototype', async () => {
    const script = `
      const http = require('node:smol-http')
      console.log('frozen=' + Object.isFrozen(http))
      console.log('proto=' + Object.getPrototypeOf(http))
    `
    const { code, stdout } = await runOnSmolBinary(script)
    expect(code).toBe(0)
    expect(stdout).toContain('frozen=true')
    expect(stdout).toContain('proto=null')
  })

  it('rejects bare `smol-http` with MODULE_NOT_FOUND (must use node: prefix)', async () => {
    const script = `
      try {
        require('smol-http')
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
