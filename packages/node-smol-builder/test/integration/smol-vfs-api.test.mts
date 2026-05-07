/**
 * @fileoverview Verify-build API-surface tests for node:smol-vfs.
 *
 * Distinct from `vfs.test.mts` which exercises the SEA + VFS injection
 * workflow. This suite locks the public API surface from
 * additions/source-patched/lib/smol-vfs.js — every named export plus
 * the lazy `SmolSqliteProvider` / `SmolPgProvider` getters that are
 * defined via ObjectDefineProperty (and thus appear as `accessor`
 * descriptors).
 */

import {
  parseExportShape,
  runOnSmolBinary,
  smolBuiltinIsAvailable,
} from '../helpers/smol-builtin.mts'

const skipTests = !smolBuiltinIsAvailable('smol-vfs')

// Eager exports (assigned via the spread). All of these resolve to the
// internal binding without lazy-loading.
const EAGER_EXPORTS = [
  'MAX_SYMLINK_DEPTH',
  'MODE_COMPAT',
  'MODE_IN_MEMORY',
  'MODE_ON_DISK',
  'VFSError',
  'accessSync',
  'canBuildSea',
  'closeSync',
  'config',
  'createReadStream',
  'default',
  'existsSync',
  'fstatSync',
  'getCacheStats',
  'getRealPath',
  'getVFSStats',
  'getVfsPath',
  'handleNativeAddon',
  'hasVFS',
  'isNativeAddon',
  'isVFSPath',
  'isVfsFd',
  'listFiles',
  'lstatSync',
  'mount',
  'mountSync',
  'openSync',
  'prefix',
  'promises',
  'readFileAsBuffer',
  'readFileAsJSON',
  'readFileAsText',
  'readFileSync',
  'readMultiple',
  'readSync',
  'readdirSync',
  'readlinkSync',
  'realpathSync',
  'size',
  'statSync',
] as const

// Lazy getters on the top-level export. Defined via ObjectDefineProperty
// to avoid pulling in SQL providers at startup.
const LAZY_GETTERS = ['SmolPgProvider', 'SmolSqliteProvider'] as const

describe.skipIf(skipTests)('node:smol-vfs api surface', () => {
  it("isBuiltin('node:smol-vfs') returns true; bare 'smol-vfs' returns false (schemelessBlockList)", async () => {
    const script = `
      const { isBuiltin } = require('node:module')
      console.log('isBuiltin(node:smol-vfs)=' + isBuiltin('node:smol-vfs'))
      console.log('isBuiltin(smol-vfs)=' + isBuiltin('smol-vfs'))
    `
    const { code, stdout } = await runOnSmolBinary(script)
    expect(code).toBe(0)
    expect(stdout).toContain('isBuiltin(node:smol-vfs)=true')
    expect(stdout).toContain('isBuiltin(smol-vfs)=false')
  })

  it("builtinModules contains 'node:smol-vfs' (prefixed form)", async () => {
    const script = `
      const { builtinModules } = require('node:module')
      console.log('contains-prefixed=' + builtinModules.includes('node:smol-vfs'))
      console.log('contains-bare=' + builtinModules.includes('smol-vfs'))
    `
    const { code, stdout } = await runOnSmolBinary(script)
    expect(code).toBe(0)
    expect(stdout).toContain('contains-prefixed=true')
    expect(stdout).toContain('contains-bare=false')
  })

  it('exposes every documented export name', async () => {
    // Use a script that lists own property names rather than the
    // shape-printer helper, since lazy getters need to be enumerated
    // separately from eager exports.
    const script = `
      const m = require('node:smol-vfs')
      const keys = Object.getOwnPropertyNames(m).sort()
      for (const k of keys) {
        const desc = Object.getOwnPropertyDescriptor(m, k)
        const kind = desc.get ? 'getter' : 'value'
        process.stdout.write('member:' + k + '=' + kind + '\\n')
      }
    `
    const { code, stdout } = await runOnSmolBinary(script)
    expect(code).toBe(0)

    const members = new Map<string, string>()
    // oxlint-disable-next-line socket/prefer-cached-for-loop -- iterable is not a bare identifier (could be Map/Set/Generator/expression)
    for (const line of stdout.split('\n')) {
      const m = /^member:([^=]+)=(.*)$/.exec(line)
      if (m) {
        members.set(m[1]!, m[2]!)
      }
    }

    for (let i = 0, { length } = EAGER_EXPORTS; i < length; i += 1) {
      const name = EAGER_EXPORTS[i]
      expect(members.get(name), `eager export ${name}`).toBe('value')
    }
    for (let i = 0, { length } = LAZY_GETTERS; i < length; i += 1) {
      const name = LAZY_GETTERS[i]
      expect(members.get(name), `lazy getter ${name}`).toBe('getter')
    }

    // No drift: any new member must be added to one of the two lists.
    const expectedNames = new Set<string>([...EAGER_EXPORTS, ...LAZY_GETTERS])
    const unexpected = [...members.keys()].filter(n => !expectedNames.has(n))
    expect(unexpected).toEqual([])
  })

  it('lazy SQL providers resolve to functions', async () => {
    // ObjectDefineProperty getters compute on first access. Asserting
    // typeof here both validates the getter wires through and that the
    // underlying provider modules are reachable inside the smol binary.
    const script = `
      const m = require('node:smol-vfs')
      console.log('SmolSqliteProvider-type=' + typeof m.SmolSqliteProvider)
      console.log('SmolPgProvider-type=' + typeof m.SmolPgProvider)
    `
    const { code, stdout } = await runOnSmolBinary(script)
    expect(code).toBe(0)
    expect(stdout).toContain('SmolSqliteProvider-type=function')
    expect(stdout).toContain('SmolPgProvider-type=function')
  })

  it('VFS mode constants are distinct numeric values', async () => {
    const script = `
      const { MODE_COMPAT, MODE_IN_MEMORY, MODE_ON_DISK, MAX_SYMLINK_DEPTH } = require('node:smol-vfs')
      console.log('MODE_COMPAT=' + MODE_COMPAT)
      console.log('MODE_IN_MEMORY=' + MODE_IN_MEMORY)
      console.log('MODE_ON_DISK=' + MODE_ON_DISK)
      console.log('distinct=' + (MODE_COMPAT !== MODE_IN_MEMORY && MODE_IN_MEMORY !== MODE_ON_DISK && MODE_COMPAT !== MODE_ON_DISK))
      console.log('depth-positive=' + (MAX_SYMLINK_DEPTH > 0))
    `
    const { code, stdout } = await runOnSmolBinary(script)
    expect(code).toBe(0)
    expect(stdout).toContain('distinct=true')
    expect(stdout).toContain('depth-positive=true')
  })

  it('module exports are frozen and null-prototype', async () => {
    const script = `
      const m = require('node:smol-vfs')
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

  it('rejects bare `smol-vfs` with MODULE_NOT_FOUND (must use node: prefix)', async () => {
    const script = `
      try {
        require('smol-vfs')
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

describe.skipIf(skipTests)(
  'node:smol-vfs api-surface helpers (parse step)',
  () => {
    it('parseExportShape correctly parses helper output', async () => {
      // Quick check that the shared helper still works against
      // smol-vfs (which is the smol-* module with the most members).
      const { code, stdout } = await runOnSmolBinary(`
        process.stdout.write('export:foo=function\\n')
        process.stdout.write('export:bar=object\\n')
      `)
      expect(code).toBe(0)
      const shape = parseExportShape(stdout)
      expect(shape.get('foo')).toBe('function')
      expect(shape.get('bar')).toBe('object')
    })
  },
)
