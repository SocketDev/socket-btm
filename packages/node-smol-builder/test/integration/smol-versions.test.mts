/**
 * @file Verify-build tests for node:smol-versions.
 *   Locks the public API surface from
 *   additions/source-patched/lib/smol-versions.js: 24 named exports +
 *   a `default` object that contains every function except VersionError
 *   (kept top-level only).
 */

import { describe, expect, it } from 'vitest'

import {
  parseExportShape,
  printExportShapeScript,
  runOnSmolBinary,
  smolBuiltinIsAvailable,
} from '../helpers/smol-builtin.mts'

const skipTests = !smolBuiltinIsAvailable('smol-versions')

const EXPECTED_EXPORTS: ReadonlyArray<readonly [string, string]> = [
  ['VersionError', 'function'],
  ['cacheStats', 'function'],
  ['clearCache', 'function'],
  ['coerce', 'function'],
  ['compare', 'function'],
  ['default', 'object'],
  ['ecosystems', 'object'],
  ['eq', 'function'],
  ['filter', 'function'],
  ['gt', 'function'],
  ['gte', 'function'],
  ['inc', 'function'],
  ['lt', 'function'],
  ['lte', 'function'],
  ['max', 'function'],
  ['maxSatisfying', 'function'],
  ['min', 'function'],
  ['minSatisfying', 'function'],
  ['neq', 'function'],
  ['parse', 'function'],
  ['rsort', 'function'],
  ['satisfies', 'function'],
  ['sort', 'function'],
  ['tryParse', 'function'],
  ['valid', 'function'],
]

describe.skipIf(skipTests)('node:smol-versions integration', () => {
  it("isBuiltin('node:smol-versions') returns true; bare 'smol-versions' returns false (schemelessBlockList)", async () => {
    const script = `
      const { isBuiltin } = require('node:module')
      console.log('isBuiltin(node:smol-versions)=' + isBuiltin('node:smol-versions'))
      console.log('isBuiltin(smol-versions)=' + isBuiltin('smol-versions'))
    `
    const { code, stdout } = await runOnSmolBinary(script)
    expect(code).toBe(0)
    expect(stdout).toContain('isBuiltin(node:smol-versions)=true')
    expect(stdout).toContain('isBuiltin(smol-versions)=false')
  })

  it("builtinModules contains 'node:smol-versions' (prefixed form)", async () => {
    const script = `
      const { builtinModules } = require('node:module')
      console.log('contains-prefixed=' + builtinModules.includes('node:smol-versions'))
      console.log('contains-bare=' + builtinModules.includes('smol-versions'))
    `
    const { code, stdout } = await runOnSmolBinary(script)
    expect(code).toBe(0)
    expect(stdout).toContain('contains-prefixed=true')
    expect(stdout).toContain('contains-bare=false')
  })

  it('exports exactly the documented API surface (no drift)', async () => {
    const { code, stdout } = await runOnSmolBinary(
      printExportShapeScript('smol-versions'),
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

  it('default export contains every function but not VersionError', async () => {
    const script = `
      const m = require('node:smol-versions')
      const fnNames = ['parse','tryParse','compare','lt','lte','gt','gte','eq','neq','sort','rsort','max','min','satisfies','maxSatisfying','minSatisfying','filter','valid','coerce','inc','cacheStats','clearCache','ecosystems']
      for (const n of fnNames) {
        console.log('default-has-' + n + '=' + (n in m.default))
      }
      console.log('default-has-VersionError=' + ('VersionError' in m.default))
    `
    const { code, stdout } = await runOnSmolBinary(script)
    expect(code).toBe(0)
    // oxlint-disable-next-line socket/prefer-cached-for-loop -- iterable is not a bare identifier (could be Map/Set/Generator/expression)
    for (const n of [
      'parse',
      'tryParse',
      'compare',
      'lt',
      'lte',
      'gt',
      'gte',
      'eq',
      'neq',
      'sort',
      'rsort',
      'max',
      'min',
      'satisfies',
      'maxSatisfying',
      'minSatisfying',
      'filter',
      'valid',
      'coerce',
      'inc',
      'cacheStats',
      'clearCache',
      'ecosystems',
    ]) {
      expect(stdout).toContain(`default-has-${n}=true`)
    }
    expect(stdout).toContain('default-has-VersionError=false')
  })

  it('module exports are frozen and null-prototype', async () => {
    const script = `
      const m = require('node:smol-versions')
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

  it('rejects bare `smol-versions` with MODULE_NOT_FOUND (must use node: prefix)', async () => {
    const script = `
      try {
        require('smol-versions')
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
