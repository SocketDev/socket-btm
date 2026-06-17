/**
 * @file Verify-build tests for node:smol-purl.
 *   Locks the public API surface from
 *   additions/source-patched/lib/smol-purl.js: 11 named exports + a
 *   `default` object containing every function (without `PurlError`,
 *   which is only on the top-level export).
 */

import { describe, expect, it } from 'vitest'

import {
  parseExportShape,
  printExportShapeScript,
  runOnSmolBinary,
  smolBuiltinIsAvailable,
} from '../helpers/smol-builtin.mts'

const skipTests = !smolBuiltinIsAvailable('smol-purl')

const EXPECTED_EXPORTS: ReadonlyArray<readonly [string, string]> = [
  ['PurlError', 'function'],
  ['build', 'function'],
  ['cacheStats', 'function'],
  ['clearCache', 'function'],
  ['default', 'object'],
  ['equals', 'function'],
  ['isValid', 'function'],
  ['normalize', 'function'],
  ['parse', 'function'],
  ['parseBatch', 'function'],
  ['tryParse', 'function'],
  ['types', 'object'],
]

describe.skipIf(skipTests)('node:smol-purl integration', () => {
  it("isBuiltin('node:smol-purl') returns true; bare 'smol-purl' returns false (schemelessBlockList)", async () => {
    const script = `
      const { isBuiltin } = require('node:module')
      console.log('isBuiltin(node:smol-purl)=' + isBuiltin('node:smol-purl'))
      console.log('isBuiltin(smol-purl)=' + isBuiltin('smol-purl'))
    `
    const { code, stdout } = await runOnSmolBinary(script)
    expect(code).toBe(0)
    expect(stdout).toContain('isBuiltin(node:smol-purl)=true')
    expect(stdout).toContain('isBuiltin(smol-purl)=false')
  })

  it("builtinModules contains 'node:smol-purl' (prefixed form)", async () => {
    const script = `
      const { builtinModules } = require('node:module')
      console.log('contains-prefixed=' + builtinModules.includes('node:smol-purl'))
      console.log('contains-bare=' + builtinModules.includes('smol-purl'))
    `
    const { code, stdout } = await runOnSmolBinary(script)
    expect(code).toBe(0)
    expect(stdout).toContain('contains-prefixed=true')
    expect(stdout).toContain('contains-bare=false')
  })

  it('exports exactly the documented API surface (no drift)', async () => {
    const { code, stdout } = await runOnSmolBinary(
      printExportShapeScript('smol-purl'),
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

  it('default export contains every function but not PurlError', async () => {
    const script = `
      const m = require('node:smol-purl')
      const fnNames = ['parse','tryParse','parseBatch','build','isValid','normalize','equals','cacheStats','clearCache','types']
      for (const n of fnNames) {
        console.log('default-has-' + n + '=' + (n in m.default))
      }
      console.log('default-has-PurlError=' + ('PurlError' in m.default))
    `
    const { code, stdout } = await runOnSmolBinary(script)
    expect(code).toBe(0)
    expect(stdout).toContain('default-has-parse=true')
    expect(stdout).toContain('default-has-tryParse=true')
    expect(stdout).toContain('default-has-parseBatch=true')
    expect(stdout).toContain('default-has-build=true')
    expect(stdout).toContain('default-has-isValid=true')
    expect(stdout).toContain('default-has-normalize=true')
    expect(stdout).toContain('default-has-equals=true')
    expect(stdout).toContain('default-has-cacheStats=true')
    expect(stdout).toContain('default-has-clearCache=true')
    expect(stdout).toContain('default-has-types=true')
    expect(stdout).toContain('default-has-PurlError=false')
  })

  it('module exports are frozen and null-prototype', async () => {
    const script = `
      const m = require('node:smol-purl')
      console.log('frozen=' + Object.isFrozen(m))
      console.log('proto=' + Object.getPrototypeOf(m))
      console.log('default-frozen=' + Object.isFrozen(m.default))
      console.log('default-proto=' + Object.getPrototypeOf(m.default))
    `
    const { code, stdout } = await runOnSmolBinary(script)
    expect(code).toBe(0)
    expect(stdout).toContain('frozen=true')
    expect(stdout).toContain('proto=null')
    expect(stdout).toContain('default-frozen=true')
    expect(stdout).toContain('default-proto=null')
  })

  it('rejects bare `smol-purl` with MODULE_NOT_FOUND (must use node: prefix)', async () => {
    const script = `
      try {
        require('smol-purl')
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
