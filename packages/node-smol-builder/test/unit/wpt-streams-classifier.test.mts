/**
 * @fileoverview Unit tests for the WPT streams classifier.
 *
 * The classifier decides whether each per-file TestResult contains
 * (a) failures that match the allowlist (expected), (b) failures that
 * don't (unexpected regression), or (c) no failures at all. Get this
 * wrong and the runner either silently masks regressions or false-fails.
 * Cover every transition.
 *
 * Pure logic only — no spawning, no submodule walk, no I/O.
 */

import { describe, expect, it } from 'vitest'

import {
  classifyResult,
  findStaleAllowlistEntries,
} from '../scripts/wpt-streams/classifier.mts'
import type { TestResult } from '../scripts/wpt-streams/types.mts'

/** Build a TestResult with sane defaults; override only fields under test. */
export function makeResult(overrides: Partial<TestResult>): TestResult {
  return {
    errors: [],
    failed: 0,
    file: 'readable-streams/general.any.js',
    passed: 0,
    total: 0,
    ...overrides,
  }
}

describe('classifyResult', () => {
  it('returns empty buckets when the file passes', () => {
    const result = makeResult({ failed: 0, passed: 5, total: 5 })
    const allowlist = new Map<string, string>()
    const { allExpected, matchedExpected, unexpected } = classifyResult(
      result,
      allowlist,
    )
    expect(allExpected).toBe(true)
    expect(matchedExpected.size).toBe(0)
    expect(unexpected).toEqual([])
  })

  it('treats a failure with no allowlist match as unexpected', () => {
    const result = makeResult({
      errors: ['some test name: assertion failed'],
      failed: 1,
      total: 1,
    })
    const allowlist = new Map<string, string>()
    const { allExpected, matchedExpected, unexpected } = classifyResult(
      result,
      allowlist,
    )
    expect(allExpected).toBe(false)
    expect(matchedExpected.size).toBe(0)
    expect(unexpected).toHaveLength(1)
    expect(unexpected[0]!.test).toBe('some test name')
    expect(unexpected[0]!.file).toBe(result.file)
  })

  it('matches a per-test allowlist entry exactly', () => {
    const result = makeResult({
      errors: ['ReadableStream teeing: expected error'],
      failed: 1,
      total: 1,
    })
    const allowlist = new Map([
      [`${result.file}:ReadableStream teeing`, 'tee monkey-patching'],
    ])
    const { allExpected, matchedExpected, unexpected } = classifyResult(
      result,
      allowlist,
    )
    expect(allExpected).toBe(true)
    expect(matchedExpected.has(`${result.file}:ReadableStream teeing`)).toBe(
      true,
    )
    expect(unexpected).toEqual([])
  })

  it('matches a file-level allowlist entry (any failure inside the file)', () => {
    const result = makeResult({
      errors: ['any test name: anything', 'another test: anything'],
      failed: 2,
      total: 2,
    })
    const allowlist = new Map([[result.file, 'runner error - file-level failure']])
    const { allExpected, matchedExpected, unexpected } = classifyResult(
      result,
      allowlist,
    )
    expect(allExpected).toBe(true)
    // File-level allowlist key fires once, regardless of how many
    // failures map to it.
    expect(matchedExpected.size).toBe(1)
    expect(matchedExpected.has(result.file)).toBe(true)
    expect(unexpected).toEqual([])
  })

  it('matches via prefix when a longer test name shares an allowlist prefix', () => {
    const result = makeResult({
      errors: ['ReadableStream teeing subtest variant 1: oops'],
      failed: 1,
      total: 1,
    })
    const allowlist = new Map([
      [`${result.file}:ReadableStream teeing`, 'tee monkey-patching'],
    ])
    const { allExpected, matchedExpected, unexpected } = classifyResult(
      result,
      allowlist,
    )
    expect(allExpected).toBe(true)
    expect(matchedExpected.has(`${result.file}:ReadableStream teeing`)).toBe(
      true,
    )
    expect(unexpected).toEqual([])
  })

  it('mixes expected and unexpected failures correctly', () => {
    const result = makeResult({
      errors: [
        'ReadableStream teeing: expected fail',
        'brand new regression: unexpected',
      ],
      failed: 2,
      total: 2,
    })
    const allowlist = new Map([
      [`${result.file}:ReadableStream teeing`, 'tee monkey-patching'],
    ])
    const { allExpected, matchedExpected, unexpected } = classifyResult(
      result,
      allowlist,
    )
    expect(allExpected).toBe(false)
    expect(matchedExpected.size).toBe(1)
    expect(unexpected).toHaveLength(1)
    expect(unexpected[0]!.test).toBe('brand new regression')
  })

  it('handles errors without a colon (treats whole string as test name)', () => {
    const result = makeResult({
      errors: ['standalone error string with no colon'],
      failed: 1,
      total: 1,
    })
    const allowlist = new Map<string, string>()
    const { unexpected } = classifyResult(result, allowlist)
    expect(unexpected).toHaveLength(1)
    expect(unexpected[0]!.test).toBe('standalone error string with no colon')
  })

  it('does NOT match an unrelated allowlist key as a prefix', () => {
    const result = makeResult({
      errors: ['some other test name: oops'],
      failed: 1,
      total: 1,
    })
    const allowlist = new Map([
      ['other-file.any.js:some test', 'unrelated'],
    ])
    const { allExpected, unexpected, matchedExpected } = classifyResult(
      result,
      allowlist,
    )
    expect(allExpected).toBe(false)
    expect(matchedExpected.size).toBe(0)
    expect(unexpected).toHaveLength(1)
  })
})

describe('findStaleAllowlistEntries', () => {
  it('returns empty when every allowlist key fired', () => {
    const allowlist = new Map([
      ['a.js:t1', 'cat'],
      ['b.js:t2', 'cat'],
    ])
    const matched = new Set(['a.js:t1', 'b.js:t2'])
    expect(findStaleAllowlistEntries(allowlist, matched)).toEqual([])
  })

  it('returns the keys that did not fire (now-passing tests)', () => {
    const allowlist = new Map([
      ['still-failing.js:t1', 'cat'],
      ['now-passing.js:t2', 'cat'],
      ['also-now-passing.js:t3', 'cat'],
    ])
    const matched = new Set(['still-failing.js:t1'])
    const stale = findStaleAllowlistEntries(allowlist, matched)
    expect(stale).toContain('now-passing.js:t2')
    expect(stale).toContain('also-now-passing.js:t3')
    expect(stale).toHaveLength(2)
  })

  it('returns every key when nothing matched', () => {
    const allowlist = new Map([
      ['a.js:t1', 'cat'],
      ['b.js:t2', 'cat'],
    ])
    const matched = new Set<string>()
    expect(findStaleAllowlistEntries(allowlist, matched).sort()).toEqual([
      'a.js:t1',
      'b.js:t2',
    ])
  })
})
