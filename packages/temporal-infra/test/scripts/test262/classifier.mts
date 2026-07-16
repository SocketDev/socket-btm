/**
 * @file Test262 result classifier.
 *   Buckets each Result into success/failure/falsePositive/falseNegative
 *   cross allowed/disallowed and reports an overall Summary. Pure
 *   functions — no I/O.
 */

import type { Result, ResultBuckets, Summary } from './types.mts'

export function emptyBuckets(): ResultBuckets {
  return {
    success: [],
    failure: [],
    falsePositive: [],
    falseNegative: [],
  }
}

/**
 * Bucket each Result and decide whether its placement is allowed
 * relative to the allowlist. Returns a Summary whose `passed` is true
 * iff every disallowed bucket is empty and no allowlist entry went
 * unmatched.
 *
 * Allowlist entries that match a test are considered "consumed"; any
 * remaining after walking results are reported as `unrecognized`
 * (stale entries — drift signal).
 */
export function interpret(
  results: readonly Result[],
  allowlist: readonly string[],
  durationMs: number,
): Summary {
  const remaining = new Set<string>(allowlist)
  const summary: Summary = {
    passed: true,
    allowed: emptyBuckets(),
    disallowed: emptyBuckets(),
    unrecognized: [],
    skipped: [],
    total: results.length,
    durationMs,
  }

  for (let i = 0, { length } = results; i < length; i += 1) {
    const result = results[i]!
    if ('skip' in result) {
      summary.skipped.push(result)
      continue
    }
    const test = result
    const desc = `${test.file} (${test.scenario})`
    const inAllowlist = remaining.has(desc)
    remaining.delete(desc)

    let classification: keyof ResultBuckets
    let isAllowed: boolean
    if (!test.expectedError) {
      if (!test.actualError) {
        classification = 'success'
        isAllowed = !inAllowlist
      } else {
        classification = 'falseNegative'
        isAllowed = inAllowlist
      }
    } else {
      if (!test.actualError) {
        classification = 'falsePositive'
        isAllowed = inAllowlist
      } else {
        classification = 'failure'
        isAllowed = !inAllowlist
      }
    }

    summary[isAllowed ? 'allowed' : 'disallowed'][classification].push(test)
    if (!isAllowed) {
      summary.passed = false
    }
  }

  summary.unrecognized = [...remaining]
  if (summary.unrecognized.length > 0) {
    summary.passed = false
  }
  return summary
}
