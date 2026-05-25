/**
 * @fileoverview Classifier — pure logic for bucketing a TestResult
 * against the allowlist.
 *
 * No I/O, no globals, no subprocesses. Exercised exhaustively by
 * test/unit/wpt-streams-classifier.test.mts. Get this wrong and the
 * runner either silently masks regressions (false-pass) or false-fails
 * the build. Cover every transition in unit tests.
 */

import type { Classification, TestResult, UnexpectedFailure } from './types.mts'

/**
 * Split an error message into (testName, restOfMessage).
 * Format that runtimes produce: "testName: error message". When no
 * colon, the whole string is treated as the test name with no message.
 */
function splitErrorIntoTestName(err: string): { rest: string; testName: string } {
  const colonIdx = err.indexOf(':')
  if (colonIdx <= 0) {
    return { rest: '', testName: err }
  }
  return { rest: err.slice(colonIdx + 1).trim(), testName: err.slice(0, colonIdx) }
}

/**
 * Classify a single file's TestResult against the allowlist.
 *
 *   - `result`: the per-file outcome.
 *   - `allowlist`: Map<key, category>. Keys are either 'file' or
 *     'file:test name'.
 *
 * Returns a Classification with:
 *   - matchedExpected: which allowlist keys this file matched (used by
 *     the runner to compute stale entries across the whole run).
 *   - unexpected: failures with NO allowlist match (regressions).
 *   - allExpected: true if every failure in this file had an allowlist
 *     match (drives the `~` yellow status row).
 */
export function classifyResult(
  result: TestResult,
  allowlist: ReadonlyMap<string, string>,
): Classification {
  const fileKey = result.file
  const isFileExpected = allowlist.has(fileKey)
  const matchedExpected = new Set<string>()
  const unexpected: UnexpectedFailure[] = []

  if (result.failed === 0) {
    return { allExpected: true, matchedExpected, unexpected }
  }

  let allExpected = true

  for (const err of result.errors) {
    const { testName } = splitErrorIntoTestName(err)
    const fullKey = `${fileKey}:${testName}`

    let matched = false
    if (allowlist.has(fullKey)) {
      matchedExpected.add(fullKey)
      matched = true
    } else if (isFileExpected) {
      matchedExpected.add(fileKey)
      matched = true
    } else {
      // Prefix matching — some allowlist keys are prefixes of actual
      // test names (e.g. allowlist key `file.js:ReadableStream teeing`
      // matches `file.js:ReadableStream teeing subtest …`).
      for (const [expKey] of allowlist) {
        if (expKey.startsWith(`${fileKey}:`) && fullKey.startsWith(expKey)) {
          matchedExpected.add(expKey)
          matched = true
          break
        }
      }
    }

    if (!matched) {
      allExpected = false
      unexpected.push({ file: fileKey, test: testName, error: err })
    }
  }

  return { allExpected, matchedExpected, unexpected }
}

/**
 * Given all matched-expected keys across the entire run, find allowlist
 * entries that didn't fire — i.e. tests that are listed as expected-fail
 * but actually passed. These are stale entries; the runner must surface
 * them so they can be removed.
 */
export function findStaleAllowlistEntries(
  allowlist: ReadonlyMap<string, string>,
  matchedAcrossRun: ReadonlySet<string>,
): string[] {
  const stale: string[] = []
  for (const key of allowlist.keys()) {
    if (!matchedAcrossRun.has(key)) {
      stale.push(key)
    }
  }
  return stale
}
