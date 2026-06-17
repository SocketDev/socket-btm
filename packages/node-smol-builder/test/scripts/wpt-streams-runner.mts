#!/usr/bin/env node
// max-file-lines: legitimate -- orchestration script — top-down pipeline (gather → validate → report); splitting fractures the flow

/**
 * WPT (Web Platform Tests) validation for fast-webstreams integration Host-side
 * orchestrator. Runs the WHATWG Streams spec tests (1,116 tests) against the
 * built node-smol binary. Tests are fetched on-demand using sparse checkout
 * from the WPT repo. Each test file is executed as a subprocess using the
 * binary, so tests run against the patched fast-webstreams (not native Node.js
 * streams). Note: this script runs under the HOST Node.js (with TypeScript
 * stripping). Each test is composed into a single script (harness + META
 * scripts + test source + epilogue) and run via `<binary> -e <script>` in the
 * binary's MAIN realm — the same shape the test262 runner uses
 * (packages/temporal-infra/test/scripts/test262/). The harness lives as plain
 * .js text at test/fixtures/wpt/harness.js; it's concatenated, never loaded as
 * an entry point, so the binary's --without-amaro constraint does not apply to
 * it. Usage: pnpm --filter node-smol-builder run wpt:streams [-- <binary-path>]
 * pnpm --filter node-smol-builder run wpt:streams -- --force pnpm --filter
 * node-smol-builder run wpt:streams -- --filter=readable-streams If no binary
 * path provided, uses the dev Final binary.
 */

import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { fileURLToPath } from 'node:url'

import { getCurrentPlatformArch } from 'build-infra/lib/platform-mappings'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { errorMessage } from 'build-infra/lib/error-utils'

import { loadAllowlist } from './wpt-streams/allowlist.mts'
import {
  classifyResult,
  findStaleAllowlistEntries,
} from './wpt-streams/classifier.mts'
import type { TestResult, UnexpectedFailure } from './wpt-streams/types.mts'

type CliOptions = {
  binary: string
  force: boolean
  filter: string
  verbose: boolean
}

const logger = getDefaultLogger()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Prevent unhandled rejections from crashing the runner
process.on('unhandledRejection', () => {})
process.on('uncaughtException', () => {})

// Runner lives at <pkg>/test/scripts/ — fleet convention (mirrors
// temporal-infra's test/scripts/test262-temporal-runner.mts).
// PACKAGE_ROOT is 2 levels up; MONOREPO_ROOT is 4 levels up.
const PACKAGE_ROOT = path.resolve(__dirname, '../..')
const MONOREPO_ROOT = path.resolve(PACKAGE_ROOT, '../..')
// Resolve the default dev binary path. Async because the platform-arch
// lookup is — kept out of module scope to avoid top-level await (the CJS
// bundle target rejects it). Mirrors test262's resolveBinary: parseArgs
// leaves binary empty, main() fills the default.
export async function resolveDefaultBinary(): Promise<string> {
  return path.join(
    PACKAGE_ROOT,
    'build/dev',
    await getCurrentPlatformArch(),
    'out/Final/node/node',
  )
}
// The submodule lives at <pkg>/test/fixtures/wpt/streams (as declared
// in .gitmodules). Sparse-checkout = streams/ inside the submodule
// means the actual WHATWG-streams test corpus is at <submodule>/streams/.
// Conceptually: `<wpt repo root>/streams/<test files>`.
const WPT_SUBMODULE_DIR = path.join(
  PACKAGE_ROOT,
  'test',
  'fixtures',
  'wpt',
  'streams',
)
const WPT_DIR = path.join(WPT_SUBMODULE_DIR, 'streams')

const FILE_TIMEOUT = 30_000 // 30s per file (some have 60+ tests)

// Path to the allowlist file. Format / rationale documented inside.
const ALLOWLIST_PATH = path.join(
  PACKAGE_ROOT,
  'wpt-config',
  'wpt-streams.allowlist',
)

/**
 * Expected failures — loaded from wpt-config/wpt-streams.allowlist (TSV:
 * `<key>\t<category>` per line). Keys are either 'file' or 'file:test name'.
 * See the allowlist file's header for the contract.
 *
 * Loaded once at module init; the classifier consumes it.
 */
const EXPECTED_FAILURES = loadAllowlist(ALLOWLIST_PATH)

// Files to skip (IDL tests, GC tests, platform-specific)
const SKIP_FILES = new Set([
  'idlharness.any.js',
  'readable-byte-streams/construct-byob-request.any.js',
  'readable-byte-streams/patched-global.any.js',
  'readable-streams/crashtests/garbage-collection.any.js',
  'readable-streams/garbage-collection.any.js',
  'readable-streams/owning-type-message-port.any.js',
  'readable-streams/owning-type-video-frame.any.js',
  'readable-streams/patched-global.any.js',
  'transferable/transform-stream-members.any.js',
  'transform-streams/patched-global.any.js',
  'writable-streams/crashtests/garbage-collection.any.js',
  'writable-streams/garbage-collection.any.js',
])

// Path of the WPT submodule relative to the monorepo root. Used as the
// argument to `scripts/git-partial-submodule.mts clone` and to
// `git submodule update`.
const WPT_SUBMODULE_REL = 'packages/node-smol-builder/test/fixtures/wpt/streams'

/**
 * Ensure the WPT streams sparse-checkout submodule is populated.
 *
 * Uses scripts/git-partial-submodule.mts to do a partial clone honoring the
 * `sparse-checkout = streams/` field in .gitmodules. Idempotent — `git
 * submodule update` is a no-op when the working tree already matches the
 * recorded gitlink SHA.
 *
 * `force` triggers a full re-init by removing the working tree first. The
 * recorded SHA (.gitmodules submodule gitlink) is the canonical version
 * pointer; no separate .wpt-version file.
 */
export async function ensureWptStreams(force: boolean = false): Promise<void> {
  if (
    force &&
    existsSync(WPT_SUBMODULE_DIR) &&
    readdirSync(WPT_SUBMODULE_DIR).length > 0
  ) {
    logger.info('Force re-fetching WPT streams (clearing working tree)')
    rmSync(WPT_SUBMODULE_DIR, { recursive: true })
  }

  // If the submodule working tree is already populated, trust it —
  // `git submodule update` reconciles any mismatch with the gitlink.
  const alreadyPopulated =
    existsSync(WPT_SUBMODULE_DIR) && readdirSync(WPT_SUBMODULE_DIR).length > 0

  if (!alreadyPopulated) {
    logger.info('Cloning WPT streams (sparse submodule)...')
    // Delegate to the fleet utility that reads sparse-checkout from
    // .gitmodules. Materializes only the streams/ subtree (~1 MB)
    // instead of the full ~5 GB WPT tree.
    await spawn(
      'node',
      [
        path.join(MONOREPO_ROOT, 'scripts', 'git-partial-submodule.mts'),
        'clone',
        WPT_SUBMODULE_REL,
      ],
      { cwd: MONOREPO_ROOT, stdio: 'inherit' },
    )
  }

  // Sync the working tree to the recorded gitlink SHA. No-op if already
  // aligned; advances the checkout if the outer repo's gitlink was
  // updated since the last clone.
  await spawn('git', ['submodule', 'update', '--init', WPT_SUBMODULE_REL], {
    cwd: MONOREPO_ROOT,
    stdio: 'inherit',
  })

  if (!existsSync(WPT_DIR) || readdirSync(WPT_DIR).length === 0) {
    throw new Error(
      `WPT streams test corpus empty at: ${WPT_DIR}. ` +
        `Check that scripts/git-partial-submodule.mts ran successfully ` +
        `and .gitmodules has sparse-checkout = streams/ on the wpt entry.`,
    )
  }
  logger.info(
    `WPT streams ready (${readdirSync(WPT_DIR).length} entries in streams/)`,
  )
}

/**
 * Find all test files.
 */
export function findTestFiles(dir: string): string[] {
  const results: string[] = []
  // oxlint-disable-next-line socket/prefer-cached-for-loop -- iterable is not a bare identifier (could be Map/Set/Generator/expression)
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      results.push(...findTestFiles(fullPath))
    } else if (entry.name.endsWith('.any.js')) {
      results.push(fullPath)
    }
  }
  return results.toSorted()
}

export function parseArgs(): CliOptions {
  const args = process.argv.slice(2)
  const opts: CliOptions = {
    // Empty = use the default dev binary, resolved in main() via
    // resolveDefaultBinary() (the platform-arch lookup is async).
    binary: '',
    filter: '',
    force: false,
    verbose: false,
  }

  // oxlint-disable-next-line socket/prefer-cached-for-loop -- iterable is not a bare identifier
  for (const arg of args) {
    if (arg === '--force') {
      opts.force = true
    } else if (arg === '--verbose') {
      opts.verbose = true
    } else if (arg.startsWith('--filter=')) {
      opts.filter = arg.slice(9)
    } else if (!arg.startsWith('--')) {
      opts.binary = arg
    }
  }
  return opts
}

// Harness polyfill, read once and concatenated into every composed
// script. Lives as plain .js text (never an entry point) — see the
// header comment in that file for why the `--without-amaro` constraint
// does NOT apply to it.
const WPT_HARNESS_PATH = path.join(PACKAGE_ROOT, 'test/fixtures/wpt/harness.js')
const WPT_HARNESS = readFileSync(WPT_HARNESS_PATH, 'utf8')

// Appended AFTER the test source. Drains self.__wptTests (populated by
// the harness's test()/promise_test()/async_test()), runs each with a
// per-test timeout, and prints exactly one JSON result line to stdout —
// the contract runTestFile parses below.
const RUN_EPILOGUE = `
;(async () => {
  const __tests = self.__wptTests
  const __TIMEOUT = self.__WPT_TEST_TIMEOUT
  let passed = 0
  let failed = 0
  const errors = []
  function withTimeout(promise) {
    let handle
    const timeout = new Promise((_, reject) => {
      handle = setTimeout(() => reject(new Error('timeout')), __TIMEOUT)
    })
    return Promise.race([promise, timeout]).finally(() => clearTimeout(handle))
  }
  for (const t of __tests) {
    try {
      if (t.type === 'sync') {
        const testObj = {
          step(fn) { return fn() },
          step_func(fn) { return fn },
          step_func_done(fn) { return fn || (() => {}) },
          unreached_func(msg) { return () => { throw new Error('unreached: ' + msg) } },
          step_timeout: setTimeout,
          add_cleanup() {},
        }
        t.fn(testObj)
        passed++
      } else if (t.type === 'promise') {
        const cleanups = []
        const testObj = {
          step(fn) { return fn() },
          step_func(fn) { return fn },
          step_func_done(fn) { return fn || (() => {}) },
          unreached_func(msg) { return () => { throw new Error('unreached: ' + msg) } },
          step_timeout: setTimeout,
          add_cleanup(fn) { cleanups.push(fn) },
        }
        try {
          await withTimeout(Promise.resolve(t.fn(testObj)))
        } finally {
          for (const fn of cleanups) { try { fn() } catch {} }
        }
        passed++
      } else if (t.type === 'async') {
        await withTimeout(t.donePromise)
        passed++
      }
    } catch (err) {
      failed++
      errors.push(t.description + ': ' + (err?.message ?? String(err)))
    }
  }
  process.stdout.write(JSON.stringify({ file: __WPT_REL_PATH, passed, failed, total: __tests.length, errors }) + '\\n')
  setTimeout(() => { process.exitCode = 0 }, 100)
})().catch(err => {
  process.stdout.write(JSON.stringify({ file: 'unknown', passed: 0, failed: 1, total: 1, errors: [err?.message ?? String(err)] }) + '\\n')
  process.exitCode = 1
})
`

/**
 * Compose the self-contained script fed to `<binary> -e`.
 *
 * Mirrors the test262 runner's composeScript: harness text + the test's META
 * scripts + the test source + the run epilogue, joined with newlines.
 * Everything runs in the binary's main realm, so globalThis.ReadableStream etc.
 * are the patched fast-webstreams.
 */
export function composeWptScript(testFile: string, relPath: string): string {
  const testDir = path.dirname(testFile)
  const content = readFileSync(testFile, 'utf8')

  // Parse META: script= directives from the leading comment block.
  const metaScripts: string[] = []
  for (const line of content.split('\n')) {
    const match = line.match(/^\/\/\s*META:\s*script=(.+)$/)
    const scriptRef = match?.[1]
    if (scriptRef) {
      metaScripts.push(path.resolve(testDir, scriptRef.trim()))
    }
    if (
      !line.startsWith('//') &&
      line.trim() !== '' &&
      !line.startsWith("'use strict'")
    ) {
      break
    }
  }

  const parts: string[] = [
    // Inject the test's relative path for the epilogue's JSON output.
    `const __WPT_REL_PATH = ${JSON.stringify(relPath)};`,
    WPT_HARNESS,
  ]
  // Absolute WPT-root refs (e.g. `/resources/idlharness.js`) resolve to
  // filesystem paths that don't exist in the sparse streams checkout.
  // Skip them like the old run-file did — the test then fails naturally
  // on the missing global, which the allowlist covers (those files are
  // in SKIP_FILES anyway).
  // oxlint-disable-next-line socket/prefer-cached-for-loop -- iterable is not a bare identifier
  for (const metaPath of metaScripts) {
    if (existsSync(metaPath)) {
      parts.push(readFileSync(metaPath, 'utf8'))
    }
  }
  parts.push(content, RUN_EPILOGUE)
  return parts.join('\n')
}

/**
 * Run a single test file as a subprocess inside the binary This ensures tests
 * run against the patched fast-webstreams, not native Node.js streams.
 */
export async function runTestFile(
  binaryPath: string,
  testFile: string,
): Promise<TestResult> {
  const relPath = path.relative(WPT_DIR, testFile)
  // Compose the full script (harness + META + test + epilogue) and run
  // it via `-e` in the binary's main realm — the same shape the test262
  // runner uses. No on-disk .mjs entry point is loaded by the binary.
  const script = composeWptScript(testFile, relPath)

  try {
    const result = await spawn(binaryPath, ['-e', script], {
      stdio: 'pipe',
      timeout: FILE_TIMEOUT,
    })

    const stdout = String(result.stdout ?? '')
    // Try to parse the JSON result line from stdout. The epilogue prints
    // exactly one, but META/test output may precede it.
    // oxlint-disable-next-line socket/prefer-cached-for-loop -- iterable is not a bare identifier
    for (const line of stdout.trim().split('\n')) {
      try {
        const parsed = JSON.parse(line) as Partial<TestResult>
        if (parsed && typeof parsed.passed === 'number') {
          return parsed as TestResult
        }
      } catch {
        // Not JSON, continue
      }
    }

    // No valid JSON result found
    if (result.code !== 0) {
      return {
        file: relPath,
        passed: 0,
        failed: 1,
        total: 1,
        errors: [`Runner exited with code ${result.code}`],
      }
    }
  } catch (e) {
    return {
      file: relPath,
      passed: 0,
      failed: 1,
      total: 1,
      errors: [`Runner error: ${errorMessage(e)}`],
    }
  }

  return {
    file: relPath,
    passed: 0,
    failed: 1,
    total: 1,
    errors: ['No test results returned'],
  }
}

async function main(): Promise<void> {
  const opts = parseArgs()
  // Fill the default dev binary when none was passed (async platform-arch
  // lookup, so it can't be a module-scope const).
  if (!opts.binary) {
    opts.binary = await resolveDefaultBinary()
  }

  logger.info('=== WPT Streams Validation ===')
  logger.error('')

  // Check binary
  if (!existsSync(opts.binary)) {
    logger.fail(`Binary not found: ${opts.binary}`)
    logger.log('')
    logger.log('Build the binary first:')
    logger.log(
      '  pnpm --filter node-smol-builder clean && pnpm --filter node-smol-builder build',
    )
    process.exitCode = 1
    return
  }

  // Ensure WPT streams is on disk. The submodule's recorded SHA
  // (.gitmodules gitlink) is the version pointer; sparse-checkout =
  // streams/ in .gitmodules is honored by
  // scripts/git-partial-submodule.mts.
  await ensureWptStreams(opts.force)

  if (!existsSync(WPT_DIR)) {
    logger.fail('WPT streams directory not found after fetch')
    process.exitCode = 1
    return
  }

  // Find test files
  let testFiles = findTestFiles(WPT_DIR)

  // Apply filter
  if (opts.filter) {
    testFiles = testFiles.filter(f =>
      path.relative(WPT_DIR, f).includes(opts.filter),
    )
  }

  // Skip problematic files
  testFiles = testFiles.filter(f => {
    const rel = path.relative(WPT_DIR, f)
    return (
      !SKIP_FILES.has(rel) && ![...SKIP_FILES].some(skip => rel.endsWith(skip))
    )
  })

  logger.info(`Binary: ${opts.binary}`)
  logger.info(`Test files: ${testFiles.length}`)
  // Surface the submodule SHA — the version pointer post-migration.
  // Best-effort; if `git -C` fails we just skip the line.
  try {
    const shaResult = await spawn(
      'git',
      ['-C', WPT_SUBMODULE_DIR, 'rev-parse', 'HEAD'],
      { stdio: ['inherit', 'pipe', 'pipe'] },
    )
    const sha = String(shaResult.stdout ?? '').trim()
    if (sha) {
      logger.info(`WPT ref: ${sha.slice(0, 8)}`)
    }
  } catch {
    // Silent — informational only.
  }
  if (opts.filter) {
    logger.info(`Filter: ${opts.filter}`)
  }
  logger.log('')

  // Run tests
  let totalPassed = 0
  let totalFailed = 0
  let totalTests = 0
  let filesWithFailures = 0

  // Track failures against expected list. `matchedExpected` accumulates
  // across files; `unexpectedFailures` collects regressions.
  const matchedExpected = new Set<string>()
  const unexpectedFailures: UnexpectedFailure[] = []

  // oxlint-disable-next-line socket/prefer-cached-for-loop -- iterable is not a bare identifier
  for (const testFile of testFiles) {
    let result: TestResult
    try {
      result = await runTestFile(opts.binary, testFile)
    } catch (e) {
      const rel = path.relative(WPT_DIR, testFile)
      result = {
        file: rel,
        passed: 0,
        failed: 1,
        total: 1,
        errors: [`Runner error: ${errorMessage(e)}`],
      }
    }

    totalPassed += result.passed
    totalFailed += result.failed
    totalTests += result.total

    // Classify this file's failures against the allowlist. The
    // classifier is pure + unit-tested at
    // test/unit/wpt-streams-classifier.test.mts.
    const classification = classifyResult(result, EXPECTED_FAILURES)
    if (result.failed > 0) {
      filesWithFailures++
    }
    for (const key of classification.matchedExpected) {
      matchedExpected.add(key)
    }
    for (const u of classification.unexpected) {
      unexpectedFailures.push(u)
    }

    // Status: green checkmark, yellow tilde (expected fail), red X (unexpected fail)
    let status
    if (result.failed === 0) {
      // oxlint-disable-next-line socket/no-status-emoji -- WPT validator emits ANSI-colored status markers ("\x1b[32m✓\x1b[0m" etc.) in column-aligned table rows; logger.success() would lose the colorization required by the WPT result format.
      status = '\x1b[32m✓\x1b[0m'
    } else {
      // oxlint-disable-next-line socket/no-status-emoji -- WPT validator emits ANSI-colored status markers ("\x1b[32m✓\x1b[0m" etc.) in column-aligned table rows; logger.success() would lose the colorization required by the WPT result format.
      status = classification.allExpected
        ? '\x1b[33m~\x1b[0m'
        : '\x1b[31m✗\x1b[0m'
    }

    logger.log(`${status} ${result.file} (${result.passed}/${result.total})`)

    if (result.failed > 0) {
      if (opts.verbose) {
        // oxlint-disable-next-line socket/prefer-cached-for-loop -- iterable is not a bare identifier (could be Map/Set/Generator/expression)
        for (const err of result.errors) {
          logger.log(`    ${err}`)
        }
      } else if (result.errors.length > 0) {
        // oxlint-disable-next-line socket/prefer-cached-for-loop -- iterable is not a bare identifier (could be Map/Set/Generator/expression)
        for (const err of result.errors.slice(0, 2)) {
          logger.log(`    ${err}`)
        }
        if (result.errors.length > 2) {
          logger.log(`    ... and ${result.errors.length - 2} more`)
        }
      }
    }
  }

  // Find expected failures that now pass (improvements) — stale
  // allowlist entries. Surfaced to the user so they can prune.
  const nowPassing = findStaleAllowlistEntries(
    EXPECTED_FAILURES,
    matchedExpected,
  )

  // Summary
  logger.log('')
  logger.log(`${'='.repeat(60)}`)
  logger.log('Results:')
  logger.log(`  Total tests: ${totalTests}`)
  logger.log(`  Passed: \x1b[32m${totalPassed}\x1b[0m`)
  logger.log(`  Failed: \x1b[31m${totalFailed}\x1b[0m`)
  logger.log(
    `  Pass rate: ${totalTests > 0 ? ((totalPassed / totalTests) * 100).toFixed(1) : 0}%`,
  )
  logger.log(`  Files with failures: ${filesWithFailures}/${testFiles.length}`)

  // Expected vs unexpected
  logger.log('')
  logger.log(
    `  Expected failures: ${matchedExpected.size}/${EXPECTED_FAILURES.size}`,
  )
  logger.log(`  Unexpected failures: ${unexpectedFailures.length}`)

  if (nowPassing.length > 0) {
    logger.log('')
    logger.log(
      '[32m✨ Tests that now PASS (update expected failures list):[0m',
    )
    for (let i = 0, { length } = nowPassing; i < length; i += 1) {
      const key = nowPassing[i]
      logger.log(`  - ${key}`)
    }
  }

  if (unexpectedFailures.length > 0) {
    logger.error('')
    // oxlint-disable-next-line socket/no-status-emoji -- WPT validator emits ANSI-colored status markers ("\x1b[32m✓\x1b[0m" etc.) in column-aligned table rows; logger.success() would lose the colorization required by the WPT result format.
    logger.fail('[31m❌ UNEXPECTED failures (regressions):[0m')
    // oxlint-disable-next-line socket/prefer-cached-for-loop -- loop variable is destructured
    for (const { file, test } of unexpectedFailures.slice(0, 10)) {
      logger.log(`  - ${file}: ${test}`)
    }
    if (unexpectedFailures.length > 10) {
      logger.log(`  ... and ${unexpectedFailures.length - 10} more`)
    }
  }

  // Exit with failure only if there are unexpected failures
  if (unexpectedFailures.length > 0) {
    logger.log('')
    logger.log('[31mFAILED: Unexpected test failures detected[0m')
    process.exitCode = 1
  } else if (totalFailed > 0) {
    logger.log('')
    logger.log(
      '[32mPASSED: All failures are expected (matches native Node 25)[0m',
    )
  }
}

main().catch(err => {
  logger.fail(`WPT runner failed: ${errorMessage(err)}`)
  process.exitCode = 1
})
