/**
 * @fileoverview Verify-build tests for node:smol-power.
 *
 * Asserts the public API documented in additions/source-patched/lib/smol-power.js:
 *   - `isOnAcPower(): boolean`
 *   - `isOnBatteryPower(): boolean`
 *   - module is frozen with a null prototype
 *   - bare `smol-power` (no node: prefix) is rejected (patch 024
 *     schemelessBlockList — bare require throws MODULE_NOT_FOUND)
 *   - `builtinModules` advertises the prefixed form `node:smol-power`
 *
 * Skips entirely if the Final/ binary hasn't been built or the
 * smol-power binding hasn't been wired in — run `pnpm build --dev` to
 * materialize one.
 */

import {
  parseExportShape,
  printExportShapeScript,
  runOnSmolBinary,
  smolBuiltinIsAvailable,
} from '../helpers/smol-builtin.mts'

const skipTests = !smolBuiltinIsAvailable('smol-power')

const EXPECTED_EXPORTS: ReadonlyArray<readonly [string, string]> = [
  ['isOnAcPower', 'function'],
  ['isOnBatteryPower', 'function'],
]

describe.skipIf(skipTests)('node:smol-power integration', () => {
  it("isBuiltin('node:smol-power') returns true; bare 'smol-power' returns false (schemelessBlockList)", async () => {
    const script = `
      const { isBuiltin } = require('node:module')
      console.log('isBuiltin(node:smol-power)=' + isBuiltin('node:smol-power'))
      console.log('isBuiltin(smol-power)=' + isBuiltin('smol-power'))
    `
    const { code, stdout } = await runOnSmolBinary(script)
    expect(code).toBe(0)
    expect(stdout).toContain('isBuiltin(node:smol-power)=true')
    expect(stdout).toContain('isBuiltin(smol-power)=false')
  })

  it("builtinModules contains 'node:smol-power' (prefixed form)", async () => {
    const script = `
      const { builtinModules } = require('node:module')
      console.log('contains-prefixed=' + builtinModules.includes('node:smol-power'))
      console.log('contains-bare=' + builtinModules.includes('smol-power'))
    `
    const { code, stdout } = await runOnSmolBinary(script)
    expect(code).toBe(0)
    expect(stdout).toContain('contains-prefixed=true')
    expect(stdout).toContain('contains-bare=false')
  })

  it('exports exactly the documented API surface (no drift)', async () => {
    const { code, stdout } = await runOnSmolBinary(
      printExportShapeScript('smol-power'),
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

  it('module exports are frozen and null-prototype', async () => {
    const script = `
      const mod = require('node:smol-power')
      console.log('frozen=' + Object.isFrozen(mod))
      console.log('proto=' + Object.getPrototypeOf(mod))
    `
    const { code, stdout } = await runOnSmolBinary(script)
    expect(code).toBe(0)
    expect(stdout).toContain('frozen=true')
    expect(stdout).toContain('proto=null')
  })

  it('isOnAcPower() and isOnBatteryPower() return inverse booleans', async () => {
    const script = `
      const power = require('node:smol-power')
      const ac = power.isOnAcPower()
      const battery = power.isOnBatteryPower()
      console.log('ac-type=' + typeof ac)
      console.log('battery-type=' + typeof battery)
      console.log('inverse=' + (ac === !battery))
    `
    const { code, stdout } = await runOnSmolBinary(script)
    expect(code).toBe(0)
    expect(stdout).toContain('ac-type=boolean')
    expect(stdout).toContain('battery-type=boolean')
    expect(stdout).toContain('inverse=true')
  })

  it('rejects bare `smol-power` with MODULE_NOT_FOUND (must use node: prefix)', async () => {
    const script = `
      try {
        require('smol-power')
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
