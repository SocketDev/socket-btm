#!/usr/bin/env node
/**
 * @fileoverview Test262 Temporal subset runner.
 *
 * Walks `packages/temporal-infra/upstream/test262/test/built-ins/Temporal/`
 * + `test/intl402/Temporal/`, executes each test against the built
 * node-smol binary, tallies pass/fail/skip.
 *
 * Why hand-rolled vs `test262-stream`: zero new deps. The Temporal
 * subset is ~700 tests — a synchronous walk is fine.
 *
 * Usage:
 *   pnpm exec node packages/temporal-infra/scripts/test262.mts
 *   pnpm exec node packages/temporal-infra/scripts/test262.mts --include 'PlainDate.prototype.with'
 *   pnpm exec node packages/temporal-infra/scripts/test262.mts --no-intl
 *   pnpm exec node packages/temporal-infra/scripts/test262.mts --limit 100
 *   pnpm exec node packages/temporal-infra/scripts/test262.mts --json /tmp/results.json
 */

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib/errors'
import { getDefaultLogger } from '@socketsecurity/lib/logger'

import {
  TEST262_HARNESS_DIR,
  TEST262_ROOT,
  TEST262_TEMPORAL_BUILTINS_DIR,
  TEST262_TEMPORAL_INTL402_DIR,
  getNodeSmolFinalBinary,
} from '../lib/paths.mts'

const logger = getDefaultLogger()

type ParsedArgs = {
  include?: string
  noIntl: boolean
  limit?: number
  json?: string
  binary?: string
  verbose: boolean
}

function parseArgs(argv: readonly string[]): ParsedArgs {
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
    } else if (arg === '--verbose' || arg === '-v') {
      opts.verbose = true
    } else if (arg === '--help' || arg === '-h') {
      printHelp()
      process.exit(0)
    }
  }
  return opts
}

function printHelp(): void {
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
  --verbose, -v         Print per-test failures inline
  --help, -h            Show this message
`)
}

interface TestCase {
  /** Absolute path to the .js test file. */
  filePath: string
  /** Path relative to the test262 root (matches upstream reporting). */
  relPath: string
  /** Raw test source. */
  source: string
  /** Parsed YAML-frontmatter attributes. */
  attrs: TestAttrs
}

interface TestAttrs {
  description?: string
  esid?: string
  features?: string[]
  flags?: string[]
  includes?: string[]
  /** Test expects to throw at the given phase with the given error type. */
  negative?: { phase: string; type: string }
  raw?: boolean
  module?: boolean
  async?: boolean
  noStrict?: boolean
  onlyStrict?: boolean
}

interface TestResult {
  relPath: string
  scenario: 'strict' | 'sloppy' | 'raw'
  status: 'pass' | 'fail' | 'skip' | 'error'
  detail?: string
}

interface RunSummary {
  total: number
  pass: number
  fail: number
  skip: number
  error: number
  durationMs: number
  failures: TestResult[]
  errors: TestResult[]
}

// ── Frontmatter parser ─────────────────────────────────────────────

// Test262 metadata: /*--- ... ---*/ YAML block. We parse the keys we
// care about by hand — full YAML is overkill.
function parseFrontmatter(source: string): TestAttrs {
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

  // negative block: nested keys.
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

function parseList(yaml: string, key: string): string[] | undefined {
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

// Load a harness file. Accepts either bare name (`assert`) or full
// filename (`assert.js`); normalizes to the basename .js form.
function loadHarness(name: string): string {
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

function composeScript(test: TestCase, mode: 'strict' | 'sloppy'): string {
  const parts: string[] = []
  if (mode === 'strict') {
    parts.push("'use strict';")
  }
  if (!test.attrs.raw) {
    for (const name of DEFAULT_INCLUDES) {
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

function* walkTests(rootDir: string): Generator<string> {
  if (!fs.existsSync(rootDir)) {
    return
  }
  const entries = fs.readdirSync(rootDir, { withFileTypes: true })
  for (const entry of entries) {
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

// ── Test execution ─────────────────────────────────────────────────

function resolveBinary(override?: string): string {
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

function runOneTest(
  test: TestCase,
  mode: 'strict' | 'sloppy' | 'raw',
  binary: string,
): TestResult {
  const script =
    mode === 'raw'
      ? test.source
      : composeScript(test, mode as 'strict' | 'sloppy')
  const result = spawnSync(binary, ['-e', script], {
    encoding: 'utf8',
    timeout: 10_000,
    maxBuffer: 4 * 1024 * 1024,
  })
  const stderr = result.stderr ?? ''
  const stdout = result.stdout ?? ''
  const threw = result.status !== 0 || stderr.includes('Error')

  if (test.attrs.negative) {
    const expectedType = test.attrs.negative.type
    if (!threw) {
      return {
        relPath: test.relPath,
        scenario: mode,
        status: 'fail',
        detail: `expected throw of ${expectedType}, got success`,
      }
    }
    // Match against stderr — V8 prints `${TypeName}: ${message}`.
    if (!stderr.includes(expectedType)) {
      return {
        relPath: test.relPath,
        scenario: mode,
        status: 'fail',
        detail: `expected ${expectedType}, stderr=${stderr.slice(0, 200)}`,
      }
    }
    return { relPath: test.relPath, scenario: mode, status: 'pass' }
  }

  if (threw) {
    return {
      relPath: test.relPath,
      scenario: mode,
      status: 'fail',
      detail: stderr.slice(0, 400) || stdout.slice(0, 200),
    }
  }
  // Test262 assertion failures throw `Test262Error: <msg>`; the script
  // exits 0 (sta.js prints to stdout). Sniff stdout.
  if (stdout.includes('Test262Error')) {
    return {
      relPath: test.relPath,
      scenario: mode,
      status: 'fail',
      detail: stdout.slice(0, 400),
    }
  }
  return { relPath: test.relPath, scenario: mode, status: 'pass' }
}

function shouldSkip(test: TestCase): string | undefined {
  // Async tests need doneprintHandle.js + completion plumbing — TODO.
  if (test.attrs.async) {
    return 'async (not yet supported)'
  }
  // Module tests need a tempfile + --input-type=module — TODO.
  if (test.attrs.module) {
    return 'module (not yet supported via -e)'
  }
  return undefined
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

  logger.log(`Test262 Temporal Subset Runner`)
  logger.log(`Binary: ${binary}`)
  logger.log(`Corpus: ${TEST262_ROOT}`)

  const includeRe = args.include ? new RegExp(args.include, 'i') : undefined
  const startTime = Date.now()

  const dirs = [TEST262_TEMPORAL_BUILTINS_DIR]
  if (!args.noIntl) {
    dirs.push(TEST262_TEMPORAL_INTL402_DIR)
  }
  const candidates: string[] = []
  for (const dir of dirs) {
    for (const filePath of walkTests(dir)) {
      const relPath = path.relative(TEST262_ROOT, filePath)
      if (includeRe && !includeRe.test(relPath)) {
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
  logger.log('')

  const summary: RunSummary = {
    total: 0,
    pass: 0,
    fail: 0,
    skip: 0,
    error: 0,
    durationMs: 0,
    failures: [],
    errors: [],
  }

  for (let i = 0, { length } = candidates; i < length; i += 1) {
    const filePath = candidates[i]
    const relPath = path.relative(TEST262_ROOT, filePath)
    const source = fs.readFileSync(filePath, 'utf8')
    const attrs = parseFrontmatter(source)
    const test: TestCase = { filePath, relPath, source, attrs }

    const skipReason = shouldSkip(test)
    if (skipReason) {
      summary.skip += 1
      summary.total += 1
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

    for (const scenario of scenarios) {
      summary.total += 1
      try {
        const result = runOneTest(test, scenario, binary)
        if (result.status === 'pass') {
          summary.pass += 1
        } else if (result.status === 'fail') {
          summary.fail += 1
          summary.failures.push(result)
          if (args.verbose) {
            logger.warn(`FAIL [${scenario}] ${relPath}: ${result.detail}`)
          }
        }
      } catch (e) {
        summary.error += 1
        summary.errors.push({
          relPath,
          scenario,
          status: 'error',
          detail: errorMessage(e),
        })
      }
    }

    if (i > 0 && i % 50 === 0) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
      logger.info(
        `Progress: ${i}/${length} (${summary.pass} pass, ${summary.fail} fail, ${summary.skip} skip, ${elapsed}s)`,
      )
    }
  }
  summary.durationMs = Date.now() - startTime

  logger.log('')
  logger.log('═══════════════════════════════════════════════════════')
  logger.log(`Total:    ${summary.total}`)
  logger.log(`Pass:     ${summary.pass}`)
  logger.log(`Fail:     ${summary.fail}`)
  logger.log(`Skip:     ${summary.skip}`)
  logger.log(`Error:    ${summary.error}`)
  logger.log(`Duration: ${(summary.durationMs / 1000).toFixed(1)}s`)
  logger.log('═══════════════════════════════════════════════════════')

  if (args.json) {
    fs.writeFileSync(args.json, JSON.stringify(summary, null, 2))
    logger.log(`JSON report: ${args.json}`)
  }

  process.exit(summary.fail > 0 || summary.error > 0 ? 1 : 0)
}

main()
