/**
 * @fileoverview Shared types for the WPT streams runner.
 */

export type TestResult = {
  file: string
  passed: number
  failed: number
  total: number
  errors: string[]
}

export type UnexpectedFailure = {
  file: string
  test: string
  error: string
}

/**
 * Outcome of classifying a TestResult against the allowlist.
 *
 *   - `matchedExpected`: set of allowlist keys that fired (file-level
 *     entries + per-test entries). Used to detect stale entries.
 *   - `unexpected`: failures NOT in the allowlist — these break the build.
 *   - `allExpected`: per-row status bit ("did EVERY failure in this file
 *     have an allowlist entry?"). Drives the `~` (yellow tilde) vs `✗`
 *     (red X) row marker.
 */
export type Classification = {
  allExpected: boolean
  matchedExpected: Set<string>
  unexpected: UnexpectedFailure[]
}
