/**
 * @fileoverview test262 Temporal — unit tests covering the runner's
 * pure parts. Today this is the classifier; future additions (e.g.
 * frontmatter parser, harness composer) land here as more `describe`
 * blocks. Spawning, corpus walking, and binary I/O stay in the
 * runner itself and are exercised by running it; this file owns the
 * deterministic pieces.
 *
 * The classifier decides whether each test result belongs in an
 * allowed or disallowed bucket relative to an allowlist. Get it
 * wrong and the runner either silently masks regressions or
 * false-fails the build. Cover every transition (success / failure
 * / falsePositive / falseNegative — each in allowed vs disallowed
 * form) plus stale-allowlist + skipped-passthrough.
 */

import { describe, expect, it } from 'vitest'

import { interpret } from '../scripts/test262-temporal-runner.mts'
import type { Test } from '../scripts/test262-temporal-runner.mts'

function key(t: Test): string {
  return `${t.file} (${t.scenario})`
}

/**
 * Build a Test record with sensible defaults so individual assertions
 * only spell out the fields they care about.
 */
function makeTest(overrides: Partial<Test>): Test {
  return {
    file: 'test/built-ins/Temporal/Instant/from.js',
    scenario: 'strict',
    expectedError: false,
    actualError: false,
    ...overrides,
  }
}

describe('interpret', () => {
  it('success → allowed.success when not in allowlist', () => {
    const t = makeTest({})
    const s = interpret([t], [], 0)
    expect(s.allowed.success.length).toBe(1)
    expect(s.disallowed.success.length).toBe(0)
    expect(s.passed).toBe(true)
  })

  it('success → disallowed.success when stale allowlist entry exists', () => {
    // Pass-as-expected BUT on the allowlist → drift signal; prune.
    const t = makeTest({})
    const s = interpret([t], [key(t)], 0)
    expect(s.disallowed.success.length).toBe(1)
    expect(s.allowed.success.length).toBe(0)
    expect(s.passed).toBe(false)
  })

  it('expected throw + actual throw → allowed.failure', () => {
    const t = makeTest({ expectedError: true, actualError: true })
    const s = interpret([t], [], 0)
    expect(s.allowed.failure.length).toBe(1)
    expect(s.passed).toBe(true)
  })

  it('expected throw + no throw → disallowed.falsePositive (regression)', () => {
    const t = makeTest({ expectedError: true, actualError: false })
    const s = interpret([t], [], 0)
    expect(s.disallowed.falsePositive.length).toBe(1)
    expect(s.passed).toBe(false)
  })

  it('no expected throw + actual throw → disallowed.falseNegative (regression)', () => {
    const t = makeTest({ expectedError: false, actualError: true })
    const s = interpret([t], [], 0)
    expect(s.disallowed.falseNegative.length).toBe(1)
    expect(s.passed).toBe(false)
  })

  it('unrecognized allowlist entry fails the run', () => {
    // Allowlist points at a test that didn't run → drift signal.
    const t = makeTest({})
    const stale = 'test/built-ins/Temporal/Duration/from.js (strict)'
    const s = interpret([t], [stale], 0)
    expect(s.unrecognized).toEqual([stale])
    expect(s.passed).toBe(false)
  })

  it('skipped results bypass classification', () => {
    // Skipped results count toward summary.total but go to skipped
    // bucket — not allowed/disallowed — and do NOT flip passed.
    const s = interpret(
      [{ skip: true, file: 'x.js', reason: 'async (not yet supported)' }],
      [],
      0,
    )
    expect(s.skipped.length).toBe(1)
    expect(s.passed).toBe(true)
  })
})
