#!/usr/bin/env node
/**
 * @fileoverview Test262 Temporal subset runner — CLI + main.
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
 * Split into the `test262/` sibling folder:
 *   - types.mts       — result types (TestCase, Test, Summary, ...)
 *   - parser.mts      — frontmatter parser
 *   - classifier.mts  — interpret + emptyBuckets
 *   - harness.mts     — loadHarness, composeScript, walkTests
 *   - executor.mts    — resolveBinary, loadAllowlist, runOneTest, shouldSkip
 *   - report.mts      — report
 *
 * Usage:
 *   pnpm --filter temporal-infra run test262:temporal
 *   pnpm --filter temporal-infra run test262:temporal -- --no-intl
 *   node test/scripts/test262-temporal-runner.mts --include 'PlainDate.prototype.with'
 *   node test/scripts/test262-temporal-runner.mts --limit 100 --json /tmp/results.json
 */

import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib-stable/errors'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger'

import {
  PACKAGE_ROOT,
  TEST262_ROOT,
  TEST262_TEMPORAL_BUILTINS_DIR,
  TEST262_TEMPORAL_INTL402_DIR,
} from '../../lib/paths.mts'

import { interpret } from './test262/classifier.mts'
import {
  loadAllowlist,
  resolveBinary,
  runOneTest,
  shouldSkip,
} from './test262/executor.mts'
import { walkTests } from './test262/harness.mts'
import { parseFrontmatter } from './test262/parser.mts'
import { report } from './test262/report.mts'
import type { Result, TestCase } from './test262/types.mts'

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
    // oxlint-disable-next-line socket/prefer-cached-for-loop -- iterable is not a bare identifier (could be Map/Set/Generator/expression)
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
    const source = readFileSync(filePath, 'utf8')
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

    for (let j = 0, { length: jlen } = scenarios; j < jlen; j += 1) {
      const scenario = scenarios[j]
      const result = runOneTest(test, scenario, binary)
      results.push(result)
      if (args.verbose && result.expectedError !== result.actualError) {
        logger.warn(`  [${scenario}] ${file}: ${result.detail?.slice(0, 200)}`)
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
    writeFileSync(args.json, JSON.stringify(summary, null, 2))
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
