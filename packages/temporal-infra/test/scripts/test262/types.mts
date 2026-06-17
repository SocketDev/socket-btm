/**
 * @fileoverview Test262 runner result types.
 *
 * Pure type declarations — no runtime code. Other modules in this
 * folder consume these via type-only imports.
 */

export interface TestCase {
  filePath: string
  /** Path relative to <test262>/ — matches the allowlist key shape. */
  file: string
  source: string
  attrs: TestAttrs
}

export interface TestAttrs {
  description?: string | undefined
  esid?: string | undefined
  features?: string[] | undefined
  flags?: string[] | undefined
  includes?: string[] | undefined
  /** Test expects to throw at <phase> with <type>. */
  negative?: { phase: string; type: string } | undefined
  raw?: boolean | undefined
  module?: boolean | undefined
  async?: boolean | undefined
  noStrict?: boolean | undefined
  onlyStrict?: boolean | undefined
}

export interface Test {
  file: string
  scenario: 'strict' | 'sloppy' | 'raw'
  /** Test expects to throw (parser/exec error). */
  expectedError: boolean
  /** Test actually threw. */
  actualError: boolean
  /** Captured stderr/stdout when failing — for verbose / JSON. */
  detail?: string | undefined
}

export interface SkippedResult {
  skip: true
  file: string
  reason: string
}

export type Result = Test | SkippedResult

export interface ResultBuckets {
  success: Test[]
  failure: Test[]
  falsePositive: Test[]
  falseNegative: Test[]
}

export interface Summary {
  passed: boolean
  allowed: ResultBuckets
  disallowed: ResultBuckets
  unrecognized: string[]
  skipped: SkippedResult[]
  total: number
  durationMs: number
}
