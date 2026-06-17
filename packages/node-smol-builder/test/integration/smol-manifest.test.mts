/**
 * @file Verify-build tests for node:smol-manifest.
 *   Locks the public API surface from
 *   additions/source-patched/lib/smol-manifest.js: 10 named exports +
 *   a `default` object containing all functions (without
 *   `ManifestError`, which is only on the top-level export).
 */

import { describe, expect, it } from 'vitest'

import {
  parseExportShape,
  printExportShapeScript,
  runOnSmolBinary,
  smolBuiltinIsAvailable,
} from '../helpers/smol-builtin.mts'

const skipTests = !smolBuiltinIsAvailable('smol-manifest')

const EXPECTED_EXPORTS: ReadonlyArray<readonly [string, string]> = [
  ['ManifestError', 'function'],
  ['analyzeLockfile', 'function'],
  ['createStreamingParser', 'function'],
  ['default', 'object'],
  ['detectFormat', 'function'],
  ['findPackages', 'function'],
  ['getPackage', 'function'],
  ['parse', 'function'],
  ['parseLockfile', 'function'],
  ['parseManifest', 'function'],
  ['supportedFiles', 'object'],
]

describe.skipIf(skipTests)('node:smol-manifest integration', () => {
  it("isBuiltin('node:smol-manifest') returns true; bare 'smol-manifest' returns false (schemelessBlockList)", async () => {
    const script = `
      const { isBuiltin } = require('node:module')
      console.log('isBuiltin(node:smol-manifest)=' + isBuiltin('node:smol-manifest'))
      console.log('isBuiltin(smol-manifest)=' + isBuiltin('smol-manifest'))
    `
    const { code, stdout } = await runOnSmolBinary(script)
    expect(code).toBe(0)
    expect(stdout).toContain('isBuiltin(node:smol-manifest)=true')
    expect(stdout).toContain('isBuiltin(smol-manifest)=false')
  })

  it("builtinModules contains 'node:smol-manifest' (prefixed form)", async () => {
    const script = `
      const { builtinModules } = require('node:module')
      console.log('contains-prefixed=' + builtinModules.includes('node:smol-manifest'))
      console.log('contains-bare=' + builtinModules.includes('smol-manifest'))
    `
    const { code, stdout } = await runOnSmolBinary(script)
    expect(code).toBe(0)
    expect(stdout).toContain('contains-prefixed=true')
    expect(stdout).toContain('contains-bare=false')
  })

  it('exports exactly the documented API surface (no drift)', async () => {
    const { code, stdout } = await runOnSmolBinary(
      printExportShapeScript('smol-manifest'),
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

  it('default export contains every function but not ManifestError', async () => {
    const script = `
      const m = require('node:smol-manifest')
      const fnNames = ['parse','parseManifest','parseLockfile','createStreamingParser','analyzeLockfile','getPackage','findPackages','detectFormat','supportedFiles']
      for (const n of fnNames) {
        console.log('default-has-' + n + '=' + (n in m.default))
      }
      console.log('default-has-ManifestError=' + ('ManifestError' in m.default))
    `
    const { code, stdout } = await runOnSmolBinary(script)
    expect(code).toBe(0)
    expect(stdout).toContain('default-has-parse=true')
    expect(stdout).toContain('default-has-parseManifest=true')
    expect(stdout).toContain('default-has-parseLockfile=true')
    expect(stdout).toContain('default-has-createStreamingParser=true')
    expect(stdout).toContain('default-has-analyzeLockfile=true')
    expect(stdout).toContain('default-has-getPackage=true')
    expect(stdout).toContain('default-has-findPackages=true')
    expect(stdout).toContain('default-has-detectFormat=true')
    expect(stdout).toContain('default-has-supportedFiles=true')
    // ManifestError is intentionally only on the top-level export.
    expect(stdout).toContain('default-has-ManifestError=false')
  })

  it('module exports are frozen and null-prototype', async () => {
    const script = `
      const m = require('node:smol-manifest')
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

  it('rejects bare `smol-manifest` with MODULE_NOT_FOUND (must use node: prefix)', async () => {
    const script = `
      try {
        require('smol-manifest')
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
