/**
 * @fileoverview Verify-build tests for node:smol-https.
 *
 * Locks the public API surface from additions/source-patched/lib/smol-https.js:
 *   - `serve(options)`: requires TLS opts, throws TypeError otherwise
 *   - `default.serve` alias
 *
 * Asserts the explicit error semantics encoded in the JS shim — calling
 * `serve({})` (no TLS) must throw TypeError with the documented message.
 *
 * Skips entirely if the Final/ binary doesn't have smol-https wired in.
 */

import {
  parseExportShape,
  printExportShapeScript,
  runOnSmolBinary,
  smolBuiltinIsAvailable,
} from '../helpers/smol-builtin.mts'

const skipTests = !smolBuiltinIsAvailable('smol-https')

const EXPECTED_EXPORTS: ReadonlyArray<readonly [string, string]> = [
  ['default', 'object'],
  ['serve', 'function'],
]

describe.skipIf(skipTests)('node:smol-https integration', () => {
  it("isBuiltin('node:smol-https') returns true; bare 'smol-https' returns false (schemelessBlockList)", async () => {
    const script = `
      const { isBuiltin } = require('node:module')
      console.log('isBuiltin(node:smol-https)=' + isBuiltin('node:smol-https'))
      console.log('isBuiltin(smol-https)=' + isBuiltin('smol-https'))
    `
    const { code, stdout } = await runOnSmolBinary(script)
    expect(code).toBe(0)
    expect(stdout).toContain('isBuiltin(node:smol-https)=true')
    expect(stdout).toContain('isBuiltin(smol-https)=false')
  })

  it("builtinModules contains 'node:smol-https' (prefixed form)", async () => {
    const script = `
      const { builtinModules } = require('node:module')
      console.log('contains-prefixed=' + builtinModules.includes('node:smol-https'))
      console.log('contains-bare=' + builtinModules.includes('smol-https'))
    `
    const { code, stdout } = await runOnSmolBinary(script)
    expect(code).toBe(0)
    expect(stdout).toContain('contains-prefixed=true')
    expect(stdout).toContain('contains-bare=false')
  })

  it('exports exactly the documented API surface (no drift)', async () => {
    const { code, stdout } = await runOnSmolBinary(
      printExportShapeScript('smol-https'),
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

  it('`default.serve` exists and matches type signature', async () => {
    const script = `
      const https = require('node:smol-https')
      console.log('default-type=' + typeof https.default)
      console.log('default-serve-type=' + typeof https.default.serve)
    `
    const { code, stdout } = await runOnSmolBinary(script)
    expect(code).toBe(0)
    expect(stdout).toContain('default-type=object')
    expect(stdout).toContain('default-serve-type=function')
  })

  it('serve() without TLS options throws TypeError', async () => {
    // The JS shim explicitly requires TLS — covers the documented
    // contract that consumers must use node:smol-http for plain HTTP.
    const script = `
      const https = require('node:smol-https')
      try {
        https.serve({ fetch: () => new Response('hi') })
        console.log('UNEXPECTED-SUCCESS')
      } catch (e) {
        console.log('error-name=' + e.name)
        console.log('error-mentions-tls=' + /TLS/i.test(e.message))
        console.log('error-mentions-smol-http=' + /smol-http/.test(e.message))
      }
    `
    const { code, stdout } = await runOnSmolBinary(script)
    expect(code).toBe(0)
    expect(stdout).not.toContain('UNEXPECTED-SUCCESS')
    expect(stdout).toContain('error-name=TypeError')
    expect(stdout).toContain('error-mentions-tls=true')
    expect(stdout).toContain('error-mentions-smol-http=true')
  })

  it('module exports are frozen and null-prototype', async () => {
    const script = `
      const https = require('node:smol-https')
      console.log('frozen=' + Object.isFrozen(https))
      console.log('proto=' + Object.getPrototypeOf(https))
    `
    const { code, stdout } = await runOnSmolBinary(script)
    expect(code).toBe(0)
    expect(stdout).toContain('frozen=true')
    expect(stdout).toContain('proto=null')
  })

  it('rejects bare `smol-https` with MODULE_NOT_FOUND (must use node: prefix)', async () => {
    const script = `
      try {
        require('smol-https')
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
