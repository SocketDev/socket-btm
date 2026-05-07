/**
 * @fileoverview glibc floor enforcement test.
 *
 * This test enforces an upper bound on the `GLIBC_2.x` symbols that the
 * built `node` binary imports. Invoke via vitest with the `GLIBC_FLOOR`
 * environment variable set to e.g. "2.17" or "2.28".
 *
 * Behavior:
 *   - GLIBC_FLOOR unset:  test is skipped (groundwork — no behavior change).
 *   - GLIBC_FLOOR=2.17:   fails if any imported symbol's version > 2.17.
 *   - GLIBC_FLOOR=2.28:   fails if any imported symbol's version > 2.28.
 *
 * Modeled on Bun's oven-sh/bun `test/js/bun/symbols.test.ts`. Uses a plain
 * integer-tuple comparator because "2.17" is not valid semver (no patch
 * component) and npm semver libs either throw or return wrong ordering.
 *
 * Wire-up (future work, once the floor is actually lowered):
 *   1. Set `GLIBC_FLOOR=2.17` as a job-level env in `node-smol.yml`.
 *   2. Add this test to the post-build suite (already picked up by
 *      `test/integration/` glob).
 *   3. On regression, the audit script `glibc:audit` names the offenders.
 *
 * See: docs/plans/glibc-floor-lowering.md
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { describe, expect, test } from 'vitest'

import { spawn } from '@socketsecurity/lib/spawn'

import { getLatestFinalBinary } from '../paths.mts'

function parseVersionTuple(raw: string): readonly number[] {
  return raw.split('.').map(n => Number(n) || 0)
}

function isAboveFloor(
  version: string,
  floor: readonly number[],
): boolean {
  const tuple = parseVersionTuple(version)
  const len = Math.max(tuple.length, floor.length)
  for (let i = 0; i < len; i++) {
    const a = tuple[i] ?? 0
    const b = floor[i] ?? 0
    if (a !== b) {
      return a > b
    }
  }
  return false
}

const GLIBC_FLOOR_RAW = process.env.GLIBC_FLOOR
const GLIBC_FLOOR = GLIBC_FLOOR_RAW ? parseVersionTuple(GLIBC_FLOOR_RAW) : undefined

describe.skipIf(
  process.platform !== 'linux' || !GLIBC_FLOOR_RAW,
)('glibc floor (GLIBC_FLOOR env)', () => {
  test('comparator self-check rejects bad inputs', () => {
    // Safety net: if this test breaks, every symbol below could pass wrongly.
    expect(isAboveFloor('2.2.5', [2, 17, 0])).toBe(false)
    expect(isAboveFloor('2.17', [2, 17, 0])).toBe(false)
    expect(isAboveFloor('2.17.0', [2, 17, 0])).toBe(false)
    expect(isAboveFloor('2.17.1', [2, 17, 0])).toBe(true)
    expect(isAboveFloor('2.18', [2, 17, 0])).toBe(true)
    expect(isAboveFloor('2.25', [2, 17, 0])).toBe(true)
    expect(isAboveFloor('3.0', [2, 17, 0])).toBe(true)
  })

  test(`built binary does not import GLIBC_ > ${GLIBC_FLOOR_RAW}`, async () => {
    const binary = getLatestFinalBinary()
    expect(existsSync(binary), `missing built binary: ${binary}`).toBe(true)

    const result = await spawn('objdump', ['-T', binary], { stdio: 'pipe' })
    expect(result.code, `objdump failed: ${result.stderr?.toString()}`).toBe(0)

    const text = result.stdout?.toString() ?? ''
    const pattern = /\(GLIBC_(\d+(?:\.\d+)+)\)\s+(\S+)/
    const offenders: Array<{ symbol: string; version: string }> = []

    for (const line of text.split('\n')) {
      const match = pattern.exec(line)
      if (!match) {
        continue
      }
      const [, version, symbol] = match
      if (isAboveFloor(version!, GLIBC_FLOOR!)) {
        offenders.push({ symbol: symbol!, version: version! })
      }
    }

    if (offenders.length > 0) {
      const lines = offenders.map(o => `  GLIBC_${o.version} ${o.symbol}`)
      throw new Error(
        `${offenders.length} symbol(s) exceed GLIBC_FLOOR=${GLIBC_FLOOR_RAW}:\n${lines.join('\n')}\n\n` +
          `To fix: add -Wl,--wrap=<symbol> to 021-glibc-compat-layer.patch\n` +
          `and implement __wrap_<symbol> in socketsecurity/compat/glibc_compat.cc.\n` +
          `See docs/plans/glibc-floor-lowering.md.`,
      )
    }
  })
})

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? '')) {
  // Direct invocation is a no-op; let vitest drive.
}
