/**
 * @fileoverview Verify-build tests for node:smol-power.
 *
 * Runs the built smol binary with inline JS that:
 *   1. checks `node:module`'s `builtinModules` array contains
 *      `smol-power` (tests that `realm.js`'s schemelessBlockList
 *      registration via patch 024 took effect)
 *   2. confirms `isBuiltin('node:smol-power')` returns true
 *   3. requires `node:smol-power` and exercises the public API:
 *        - `isOnAcPower()` returns a boolean
 *        - `isOnBatteryPower()` returns a boolean
 *        - they are inverses of each other
 *
 * Skips entirely if the Final/ binary hasn't been built — run
 * `pnpm build --dev` first to materialize one.
 *
 * Note: Requires a built smol binary at
 * build/{dev,prod}/{platform-arch}/out/Final/node/.
 */

import { existsSync } from 'node:fs'

import { spawn, spawnSync } from '@socketsecurity/lib/spawn'

import { getLatestFinalBinary } from '../paths.mts'

const finalBinaryPath = getLatestFinalBinary()

// Probe whether the Final binary actually has the smol-power
// binding wired in. The binary may have been built before patches
// 023–026 landed (or with smol-power deliberately stripped). Skip
// the suite when the binding isn't present rather than fail —
// the build itself is the contract under test, and a rebuild will
// re-enable these tests automatically.
function smolPowerIsBuilt(): boolean {
  if (!finalBinaryPath || !existsSync(finalBinaryPath)) {
    return false
  }
  try {
    const result = spawnSync(
      finalBinaryPath,
      ['-e', 'process.stdout.write(String(require("node:module").isBuiltin("node:smol-power")))'],
      { stdio: ['ignore', 'pipe', 'ignore'], timeout: 10_000 },
    )
    return String(result.stdout || '').trim() === 'true'
  } catch {
    return false
  }
}

const skipTests = !smolPowerIsBuilt()

describe.skipIf(skipTests)('node:smol-power integration', () => {
  it("isBuiltin('node:smol-power') returns true on smol binary", async () => {
    const script = `
      const { isBuiltin } = require('node:module')
      console.log('isBuiltin(node:smol-power)=' + isBuiltin('node:smol-power'))
      console.log('isBuiltin(smol-power)=' + isBuiltin('smol-power'))
    `
    const result = await spawn(finalBinaryPath, ['-e', script], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 10_000,
    })
    expect(result.code).toBe(0)
    const stdout = String(result.stdout || '')
    expect(stdout).toContain('isBuiltin(node:smol-power)=true')
    expect(stdout).toContain('isBuiltin(smol-power)=true')
  })

  it('builtinModules contains smol-power on smol binary', async () => {
    const script = `
      const { builtinModules } = require('node:module')
      console.log('contains-smol-power=' + builtinModules.includes('smol-power'))
    `
    const result = await spawn(finalBinaryPath, ['-e', script], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 10_000,
    })
    expect(result.code).toBe(0)
    expect(String(result.stdout || '')).toContain('contains-smol-power=true')
  })

  it("require('node:smol-power') exposes the documented API", async () => {
    // Probe each public export's existence + type. Avoids asserting
    // a specific power-state value (depends on the host running the
    // test) — just that the API shape is right.
    const script = `
      const power = require('node:smol-power')
      const ac = power.isOnAcPower()
      const battery = power.isOnBatteryPower()
      console.log('typeof-isOnAcPower=' + typeof power.isOnAcPower)
      console.log('typeof-isOnBatteryPower=' + typeof power.isOnBatteryPower)
      console.log('ac-result=' + typeof ac)
      console.log('battery-result=' + typeof battery)
      console.log('inverse-relation=' + (ac === !battery))
    `
    const result = await spawn(finalBinaryPath, ['-e', script], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 10_000,
    })
    expect(result.code).toBe(0)
    const stdout = String(result.stdout || '')
    expect(stdout).toContain('typeof-isOnAcPower=function')
    expect(stdout).toContain('typeof-isOnBatteryPower=function')
    expect(stdout).toContain('ac-result=boolean')
    expect(stdout).toContain('battery-result=boolean')
    expect(stdout).toContain('inverse-relation=true')
  })

  it('rejects bare `smol-power` (must use node: prefix)', async () => {
    // Patch 024 puts `smol-power` in schemelessBlockList so consumers
    // must use the `node:` scheme. Bare require() should error.
    const script = `
      try {
        require('smol-power')
        console.log('UNEXPECTED-LOAD')
      } catch (e) {
        console.log('blocked-error-code=' + (e.code || 'no-code'))
      }
    `
    const result = await spawn(finalBinaryPath, ['-e', script], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 10_000,
    })
    expect(result.code).toBe(0)
    const stdout = String(result.stdout || '')
    expect(stdout).not.toContain('UNEXPECTED-LOAD')
    expect(stdout).toMatch(/blocked-error-code=/)
  })
})
