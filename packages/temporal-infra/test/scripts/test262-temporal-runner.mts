#!/usr/bin/env node
/**
 * @fileoverview Test262 Temporal subset runner.
 *
 * Drives `packages/temporal-infra/upstream/test262/test/built-ins/Temporal/`
 * + `test/intl402/Temporal/` through the built node-smol binary,
 * classifies each result against an allowlist of known-failures, and
 * exits non-zero on regression OR stale allowlist entry.
 *
 * Shape mirrors ultrathink's `test262-parser-runner/report.mts` —
 * same vocabulary (`success/failure/falsePositive/falseNegative`),
 * same `allowed/disallowed` buckets, same allowlist semantics. This
 * runner additionally handles execution (vs ultrathink's parser-only
 * model): harness composition, strict/sloppy/raw scenarios, throw vs
 * pass diff, negative-frontmatter phase matching.
 *
 * Frontmatter is parsed inline (no test262-stream dep): Temporal
 * tests don't use `$INCLUDE(...)` so a minimal YAML-subset parser
 * covers the surface we need.
 *
 * Usage:
 *   pnpm --filter temporal-infra run test262:temporal
 *   pnpm --filter temporal-infra run test262:temporal -- --no-intl
 *   node test/scripts/test262-temporal-runner.mts --include 'PlainDate.prototype.with'
 *   node test/scripts/test262-temporal-runner.mts --limit 100 --json /tmp/results.json
 */

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib/errors'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
// Per fleet convention (CLAUDE.md "Spawn helpers"): use
// `@socketsecurity/lib/spawn`'s exports, not `node:child_process`. The
// lib's `spawnSync` is signature-compatible with node's — drop-in
// replacement. `spawn` (async) would also work here but `runOneTest`
// is called from a sync corpus walker, so the sync variant is the
// right pick.
import { spawnSync } from '@socketsecurity/lib/spawn'

import {
  PACKAGE_ROOT,
  TEST262_HARNESS_DIR,
  TEST262_ROOT,
  TEST262_TEMPORAL_BUILTINS_DIR,
  TEST262_TEMPORAL_INTL402_DIR,
  getNodeSmolFinalBinary,
} from '../../lib/paths.mts'

const logger = getDefaultLogger()

// Allowlist file lives alongside the runner config.
const ALLOWLIST_PATH = path.join(
  PACKAGE_ROOT,
  'test262-config',
  'test262.allowlist',
)

// ── CLI ────────────────────────────────────────────────────────────

type ParsedArgs = {
  include?: string | undefined
  noIntl: boolean
  limit?: number | undefined
  json?: string | undefined
  binary?: string | undefined
  verbose: boolean
  allowlist?: string | undefined
}

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const opts: ParsedArgs = { noIntl: false, verbose: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--include' && i + 1 < argv.length) {
      opts.include = argv[++i]
    } else if (arg === '--no-intl') {
      opts.noIntl = true
    } else if (arg === '--limit' && i + 1 < argv.length) {
      opts.limit = Number.parseInt(argv[++i], 10)
    } else if (arg === '--json' && i + 1 < argv.length) {
      opts.json = argv[++i]
    } else if (arg === '--binary' && i + 1 < argv.length) {
      opts.binary = argv[++i]
    } else if (arg === '--allowlist' && i + 1 < argv.length) {
      opts.allowlist = argv[++i]
    } else if (arg === '--verbose' || arg === '-v') {
      opts.verbose = true
    } else if (arg === '--help' || arg === '-h') {
      printHelp()
      process.exit(0)
    }
  }
  return opts
}

export function printHelp(): void {
  logger.log(`
Test262 Temporal Subset Runner

Usage:
  node scripts/test262.mts [options]

Options:
  --include <regex>     Only run tests whose path matches this regex
  --no-intl             Skip the intl402/Temporal/ subset
  --limit <n>           Run at most N tests (after filtering)
  --json <path>         Write a JSON report to <path>
  --binary <path>       Path to the Node.js binary (default: built node-smol)
  --allowlist <path>    Path to a known-failures allowlist file
                        (default: test262-config/test262.allowlist)
  --verbose, -v         Print per-test classification inline
  --help, -h            Show this message
`)
}

// ── Types ──────────────────────────────────────────────────────────

interface TestCase {
  filePath: string
  /** Path relative to <test262>/ — matches the allowlist key shape. */
  file: string
  source: string
  attrs: TestAttrs
}

interface TestAttrs {
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

// ── Classifier ─────────────────────────────────────────────────────

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

// ── Frontmatter parser ─────────────────────────────────────────────

// Test262 metadata: /*--- ... ---*/ YAML block. Hand-rolled
// minimal parser — Temporal subset has no $INCLUDE expansion and a
// stable frontmatter shape (description/esid/features/flags/includes/
// negative). Full YAML is overkill.
export function parseFrontmatter(source: string): TestAttrs {
  const match = source.match(/\/\*---([\s\S]*?)---\*\//)
  if (!match) {
    return {}
  }
  const yaml = match[1]
  const attrs: TestAttrs = {}

  const descMatch = yaml.match(/^description:\s*([^\n]+)/m)
  if (descMatch) {
    attrs.description = descMatch[1].trim().replace(/^["']|["']$/g, '')
  }
  const esidMatch = yaml.match(/^esid:\s*([^\n]+)/m)
  if (esidMatch) {
    attrs.esid = esidMatch[1].trim()
  }

  attrs.features = parseList(yaml, 'features')
  attrs.includes = parseList(yaml, 'includes')

  const flags = parseList(yaml, 'flags')
  attrs.flags = flags
  if (flags) {
    attrs.raw = flags.includes('raw')
    attrs.module = flags.includes('module')
    attrs.async = flags.includes('async')
    attrs.noStrict = flags.includes('noStrict')
    attrs.onlyStrict = flags.includes('onlyStrict')
  }

  const negMatch = yaml.match(/^negative:\s*\n((?:[ \t]+[^\n]+\n?)+)/m)
  if (negMatch) {
    const negBlock = negMatch[1]
    const phaseMatch = negBlock.match(/phase:\s*([^\n]+)/)
    const typeMatch = negBlock.match(/type:\s*([^\n]+)/)
    if (phaseMatch && typeMatch) {
      attrs.negative = {
        phase: phaseMatch[1].trim(),
        type: typeMatch[1].trim(),
      }
    }
  }

  return attrs
}

export function parseList(yaml: string, key: string): string[] | undefined {
  const inlineMatch = yaml.match(
    new RegExp(`^${key}:\\s*\\[([^\\]]*)\\]`, 'm'),
  )
  if (inlineMatch) {
    return inlineMatch[1]
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
  }
  const blockMatch = yaml.match(
    new RegExp(`^${key}:\\s*\\n((?:[ \\t]+-[^\\n]+\\n?)+)`, 'm'),
  )
  if (blockMatch) {
    return blockMatch[1]
      .split('\n')
      .map(line => line.replace(/^[ \t]*-\s*/, '').trim())
      .filter(Boolean)
  }
  return undefined
}

// ── Harness loader ─────────────────────────────────────────────────

const harnessCache = new Map<string, string>()

export function loadHarness(name: string): string {
  const filename = name.endsWith('.js') ? name : `${name}.js`
  const cached = harnessCache.get(filename)
  if (cached !== undefined) {
    return cached
  }
  const filePath = path.join(TEST262_HARNESS_DIR, filename)
  const content = fs.readFileSync(filePath, 'utf8')
  harnessCache.set(filename, content)
  return content
}

// Mandatory harness files per
// https://github.com/tc39/test262/blob/main/INTERPRETING.md
const DEFAULT_INCLUDES = ['assert.js', 'sta.js']

export function composeScript(
  test: TestCase,
  scenario: 'strict' | 'sloppy',
): string {
  const parts: string[] = []
  if (scenario === 'strict') {
    parts.push("'use strict';")
  }
  if (!test.attrs.raw) {
    for (let i = 0, { length } = DEFAULT_INCLUDES; i < length; i += 1) {
      const name = DEFAULT_INCLUDES[i]
      parts.push(loadHarness(name))
    
    }
    for (const include of test.attrs.includes ?? []) {
      parts.push(loadHarness(include))
    }
  }
  parts.push(test.source)
  return parts.join('\n')
}

// ── Walker ─────────────────────────────────────────────────────────

export function* walkTests(rootDir: string): Generator<string> {
  if (!fs.existsSync(rootDir)) {
    return
  }
  const entries = fs.readdirSync(rootDir, { withFileTypes: true })
  for (let i = 0, { length } = entries; i < length; i += 1) {
    const entry = entries[i]
    const fullPath = path.join(rootDir, entry.name)
    if (entry.isDirectory()) {
      yield* walkTests(fullPath)
    } else if (entry.isFile()) {
      // Skip include-only fixtures.
      if (!entry.name.endsWith('.js') || entry.name.endsWith('_FIXTURE.js')) {
        continue
      }
      yield fullPath
    }
  
  }
}

// ── Allowlist ──────────────────────────────────────────────────────

export function loadAllowlist(filePath: string): string[] {
  if (!fs.existsSync(filePath)) {
    return []
  }
  return fs
    .readFileSync(filePath, 'utf8')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith('#'))
}

// ── Execution ──────────────────────────────────────────────────────

export function resolveBinary(override?: string): string {
  if (override) {
    if (!fs.existsSync(override)) {
      throw new Error(`Binary not found at --binary ${override}`)
    }
    return override
  }
  const candidate = getNodeSmolFinalBinary()
  if (!fs.existsSync(candidate)) {
    throw new Error(
      `Built node-smol binary not found at ${candidate}\n` +
        `Run \`pnpm --filter node-smol-builder run build\` first, ` +
        `or pass --binary <path>.`,
    )
  }
  return candidate
}

export function runOneTest(
  test: TestCase,
  scenario: 'strict' | 'sloppy' | 'raw',
  binary: string,
): Test {
  const script =
    scenario === 'raw'
      ? test.source
      : composeScript(test, scenario as 'strict' | 'sloppy')
  const result = spawnSync(binary, ['-e', script], {
    encoding: 'utf8',
    timeout: 10_000,
    maxBuffer: 4 * 1024 * 1024,
  })
  const stderr = result.stderr ?? ''
  const stdout = result.stdout ?? ''
  // Non-zero exit OR Test262Error in stdout (sta.js's throwing
  // assertion writes the error to stdout via Test262Error.toString).
  const actualError =
    result.status !== 0 ||
    stderr.length > 0 ||
    stdout.includes('Test262Error')

  const expectedError = test.attrs.negative !== undefined

  // Build detail only when we'd want to inspect — saves memory on
  // long runs. Allowlist matching doesn't read .detail.
  let detail: string | undefined
  if (expectedError !== actualError) {
    detail = (stderr || stdout).slice(0, 400)
  }

  return {
    file: test.file,
    scenario,
    expectedError,
    actualError,
    detail,
  }
}

export function shouldSkip(test: TestCase): string | undefined {
  if (test.attrs.async) {
    return 'async (not yet supported)'
  }
  if (test.attrs.module) {
    return 'module (not yet supported via -e)'
  }
  return undefined
}

// ── Report ─────────────────────────────────────────────────────────

export function report(summary: Summary): void {
  const goodNews = [
    `${summary.allowed.success.length} tests passed (no error expected, none thrown)`,
    `${summary.allowed.failure.length} tests passed (error expected, expected error thrown)`,
    `${summary.allowed.falsePositive.length} tests classified as falsePositive but allowlisted`,
    `${summary.allowed.falseNegative.length} tests classified as falseNegative but allowlisted`,
    `${summary.skipped.length} tests skipped`,
  ]

  const badSections: Array<{ tests: Test[] | string[]; label: string }> = [
    {
      tests: summary.disallowed.success,
      label:
        'tests passed despite being in the allowlist (remove the entry)',
    },
    {
      tests: summary.disallowed.failure,
      label:
        'tests threw expected error despite being in the allowlist (remove the entry)',
    },
    {
      tests: summary.disallowed.falsePositive,
      label:
        'tests expected to throw, did not (regression — add to allowlist or fix)',
    },
    {
      tests: summary.disallowed.falseNegative,
      label:
        'tests threw unexpectedly (regression — add to allowlist or fix)',
    },
    {
      tests: summary.unrecognized,
      label:
        'allowlist entries did not match any test (stale — remove)',
    },
  ]

  logger.log('')
  logger.log('═══════════════════════════════════════════════════════')
  logger.log(`Test262 Temporal subset summary (${(summary.durationMs / 1000).toFixed(1)}s)`)
  logger.log('═══════════════════════════════════════════════════════')
  for (let i = 0; i < goodNews.length; i++) {
    logger.success(goodNews[i]!)
  }

  if (!summary.passed) {
    logger.log('')
    logger.log('Disallowed results:')
    for (let i = 0, { length } = badSections; i < length; i += 1) {
      const section = badSections[i]
      if (section.tests.length === 0) {
        continue
      }
      logger.warn(` ✘ ${section.tests.length} ${section.label}`)
      for (const t of section.tests) {
        const line = typeof t === 'string' ? t : `${t.file} (${t.scenario})`
        logger.log(`   ${line}`)
      }
    
    }
  }
}

// ── Main ───────────────────────────────────────────────────────────

function main(): void {
  const args = parseArgs(process.argv.slice(2))
  let binary: string
  try {
    binary = resolveBinary(args.binary)
  } catch (e) {
    logger.error(errorMessage(e))
    process.exit(1)
  }

  const allowlist = loadAllowlist(args.allowlist ?? ALLOWLIST_PATH)

  logger.log('Test262 Temporal Subset Runner')
  logger.log(`Binary:    ${binary}`)
  logger.log(`Corpus:    ${TEST262_ROOT}`)
  logger.log(`Allowlist: ${allowlist.length} entries`)
  logger.log('')

  const includeRe = args.include ? new RegExp(args.include, 'i') : undefined
  const startTime = Date.now()

  const dirs = [TEST262_TEMPORAL_BUILTINS_DIR]
  if (!args.noIntl) {
    dirs.push(TEST262_TEMPORAL_INTL402_DIR)
  }
  const candidates: string[] = []
  for (let i = 0, { length } = dirs; i < length; i += 1) {
    const dir = dirs[i]
    for (const filePath of walkTests(dir)) {
      const file = path.relative(TEST262_ROOT, filePath)
      if (includeRe && !includeRe.test(file)) {
        continue
      }
      candidates.push(filePath)
      if (args.limit && candidates.length >= args.limit) {
        break
      }
    }
    if (args.limit && candidates.length >= args.limit) {
      break
    }
  
  }
  logger.log(`Tests to run: ${candidates.length}`)

  const results: Result[] = []
  for (let i = 0, { length } = candidates; i < length; i += 1) {
    const filePath = candidates[i]
    const file = path.relative(TEST262_ROOT, filePath)
    const source = fs.readFileSync(filePath, 'utf8')
    const attrs = parseFrontmatter(source)
    const test: TestCase = { filePath, file, source, attrs }

    const skipReason = shouldSkip(test)
    if (skipReason) {
      results.push({ skip: true, file, reason: skipReason })
      continue
    }

    const scenarios: Array<'strict' | 'sloppy' | 'raw'> = []
    if (attrs.raw) {
      scenarios.push('raw')
    } else if (attrs.onlyStrict) {
      scenarios.push('strict')
    } else if (attrs.noStrict) {
      scenarios.push('sloppy')
    } else {
      scenarios.push('strict', 'sloppy')
    }

    for (let i = 0, { length } = scenarios; i < length; i += 1) {
      const scenario = scenarios[i]
      const result = runOneTest(test, scenario, binary)
      results.push(result)
      if (args.verbose && result.expectedError !== result.actualError) {
        logger.warn(
          `  [${scenario}] ${file}: ${result.detail?.slice(0, 200)}`,
        )
      }
    
    }

    if (i > 0 && i % 50 === 0) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
      logger.info(`Progress: ${i}/${length} (${elapsed}s)`)
    }
  }

  const summary = interpret(results, allowlist, Date.now() - startTime)
  report(summary)

  if (args.json) {
    fs.writeFileSync(args.json, JSON.stringify(summary, null, 2))
    logger.log(`JSON report: ${args.json}`)
  }

  process.exit(summary.passed ? 0 : 1)
}

// Only invoke main() when run directly (e.g. `node …test262-temporal-runner.mts`),
// not when imported by the vitest unit test that exercises `interpret`.
// Without this guard, an import would walk the corpus + spawn the binary.
if (import.meta.main) {
  main()
}
