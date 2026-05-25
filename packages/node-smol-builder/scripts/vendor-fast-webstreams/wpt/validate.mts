#!/usr/bin/env node
// max-file-lines: legitimate -- orchestration script — top-down pipeline (gather → validate → report); splitting fractures the flow

/**
 * WPT (Web Platform Tests) validation for fast-webstreams integration
 *
 * Host-side orchestrator. Runs the WHATWG Streams spec tests (1,116 tests)
 * against the built node-smol binary. Tests are fetched on-demand using
 * sparse checkout from the WPT repo. Each test file is executed as a
 * subprocess using the binary, so tests run against the patched
 * fast-webstreams (not native Node.js streams).
 *
 * Note: this script runs under the HOST Node.js (with TypeScript
 * stripping). The subprocess fixtures it spawns (run-file, harness)
 * run under the built node-smol binary which is --without-amaro, so
 * those must stay .mjs. See packages/node-smol-builder/test/fixtures/wpt/.
 *
 * Usage:
 *   node scripts/vendor-fast-webstreams/wpt/validate.mts [binary-path]
 *   node scripts/vendor-fast-webstreams/wpt/validate.mts --fetch   # Force re-fetch
 *   node scripts/vendor-fast-webstreams/wpt/validate.mts --filter=readable-streams
 *
 * If no binary path provided, uses the dev Final binary.
 */

import { existsSync, readdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { fileURLToPath } from 'node:url'

import { getCurrentPlatformArch } from 'build-infra/lib/platform-mappings'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger'
import { spawn } from '@socketsecurity/lib-stable/spawn/spawn'

import { errorMessage } from 'build-infra/lib/error-utils'

type CliOptions = {
  binary: string
  fetch: boolean
  filter: string
  verbose: boolean
}

type TestResult = {
  file: string
  passed: number
  failed: number
  total: number
  errors: string[]
}

type UnexpectedFailure = {
  file: string
  test: string
  error: string
}

const logger = getDefaultLogger()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Prevent unhandled rejections from crashing the runner
process.on('unhandledRejection', () => {})
process.on('uncaughtException', () => {})

const PACKAGE_ROOT = path.resolve(__dirname, '../../..')
const MONOREPO_ROOT = path.resolve(PACKAGE_ROOT, '../..')
const PLATFORM_ARCH = await getCurrentPlatformArch()
const DEFAULT_BINARY = path.join(
  PACKAGE_ROOT,
  'build/dev',
  PLATFORM_ARCH,
  'out/Final/node/node',
)
// The submodule lives at <__dirname>/streams (as declared in
// .gitmodules). Sparse-checkout = streams/ inside the submodule means
// the actual WHATWG-streams test corpus is at <submodule>/streams/.
// Conceptually: `<wpt repo root>/streams/<test files>`.
const WPT_SUBMODULE_DIR = path.join(__dirname, 'streams')
const WPT_DIR = path.join(WPT_SUBMODULE_DIR, 'streams')

const FILE_TIMEOUT = 30_000 // 30s per file (some have 60+ tests)

/**
 * Expected failures - these match native Node 25's failures (17 tests).
 * Format: 'file:test name' or just 'file' for entire file failures.
 * These are tracked to ensure we don't regress beyond native.
 */
const EXPECTED_FAILURES = new Map([
  // === owning type not implemented (5 tests) ===
  // The 'owning' stream type is a newer WHATWG spec extension not in Node.js
  [
    'readable-streams/owning-type.any.js:ReadableStream can be constructed with owning type',
    'owning type not implemented',
  ],
  [
    'readable-streams/owning-type.any.js:ReadableStream of type owning should call start with a ReadableStreamDefaultController',
    'owning type not implemented',
  ],
  [
    'readable-streams/owning-type.any.js:ReadableStream should be able to call enqueue with an empty transfer list',
    'owning type not implemented',
  ],
  [
    'readable-streams/owning-type.any.js:ReadableStream should check transfer parameter',
    'owning type not implemented',
  ],
  [
    'readable-streams/owning-type.any.js:ReadableStream of type owning should transfer enqueued chunks',
    'owning type not implemented',
  ],

  // === Tee monkey-patching (8 tests) ===
  // WPT tests replace globalThis.ReadableStream with a throwing fake and expect tee() not to use it.
  // Fast's tee() uses the patched global internally, so it fails when the test replaces it.
  ['readable-streams/tee.any.js:ReadableStream teeing', 'tee monkey-patching'],
  [
    'readable-streams/tee.any.js:ReadableStreamTee should not pull more chunks than can fit in the branch queue',
    'tee monkey-patching',
  ],
  [
    'readable-streams/tee.any.js:ReadableStreamTee should only pull enough to fill the emptiest queue',
    'tee monkey-patching',
  ],
  [
    'readable-streams/tee.any.js:ReadableStreamTee should not pull when original is already errored',
    'tee monkey-patching',
  ],
  [
    'readable-streams/tee.any.js:ReadableStreamTee stops pulling when original stream errors while branch 1 is reading',
    'tee monkey-patching',
  ],
  [
    'readable-streams/tee.any.js:ReadableStreamTee stops pulling when original stream errors while branch 2 is reading',
    'tee monkey-patching',
  ],
  [
    'readable-streams/tee.any.js:ReadableStreamTee stops pulling when original stream errors while both branches are reading',
    'tee monkey-patching',
  ],

  // === AsyncIteratorPrototype cross-realm (1 test) ===
  // VM context isolation causes cross-realm prototype mismatch
  [
    'readable-streams/async-iterator.any.js:Async iterator instances should have the correct list of properties',
    'cross-realm AsyncIteratorPrototype',
  ],

  // === BYOB cancel (2 tests) ===
  // Byte stream edge cases with cancel propagation
  [
    'readable-byte-streams/templated.any.js:ReadableStream with byte source (empty) BYOB reader',
    'BYOB cancel edge case',
  ],
  [
    'readable-byte-streams/bad-buffers-and-views.any.js',
    'runner error - file-level failure',
  ],

  // === Subclassing (1 test) ===
  // Subclassing Fast streams doesn't preserve extra methods on the subclass
  [
    'readable-streams/general.any.js:Subclassing ReadableStream should work',
    'subclassing not fully supported',
  ],
])

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
const WPT_SUBMODULE_REL =
  'packages/node-smol-builder/scripts/vendor-fast-webstreams/wpt/streams'

/**
 * Ensure the WPT streams sparse-checkout submodule is populated.
 *
 * Uses scripts/git-partial-submodule.mts to do a partial clone honoring
 * the `sparse-checkout = streams/` field in .gitmodules. Idempotent —
 * `git submodule update` is a no-op when the working tree already
 * matches the recorded gitlink SHA.
 *
 * `force` triggers a full re-init by removing the working tree first.
 * The recorded SHA (.gitmodules submodule gitlink) is the canonical
 * version pointer; no separate .wpt-version file.
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
    existsSync(WPT_SUBMODULE_DIR) &&
    readdirSync(WPT_SUBMODULE_DIR).length > 0

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
  await spawn(
    'git',
    ['submodule', 'update', '--init', WPT_SUBMODULE_REL],
    { cwd: MONOREPO_ROOT, stdio: 'inherit' },
  )

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
 * Find all test files
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
  return results.sort()
}

export function parseArgs(): CliOptions {
  const args = process.argv.slice(2)
  const opts: CliOptions = {
    binary: DEFAULT_BINARY,
    fetch: false,
    filter: '',
    verbose: false,
  }

  for (let i = 0, { length } = args; i < length; i += 1) {
    const arg = args[i]
    if (arg === '--fetch') {
      opts.fetch = true
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

/**
 * Run a single test file as a subprocess inside the binary
 * This ensures tests run against the patched fast-webstreams, not native Node.js streams
 */
export async function runTestFile(
  binaryPath: string,
  testFile: string,
): Promise<TestResult> {
  const relPath = path.relative(WPT_DIR, testFile)
  // Fixtures live outside scripts/ because they're executed by the
  // built node-smol binary (`--without-amaro`, .mjs required), not by
  // the host Node that runs this orchestrator.
  const runnerScript = path.join(PACKAGE_ROOT, 'test/fixtures/wpt/run-file.mjs')

  try {
    const result = await spawn(binaryPath, [runnerScript, testFile], {
      stdio: 'pipe',
      timeout: FILE_TIMEOUT,
    })

    const stdout = String(result.stdout ?? '')
    // Try to parse JSON from stdout
    const lines = stdout.trim().split('\n')
    for (let i = 0, { length } = lines; i < length; i += 1) {
      const line = lines[i]
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
  await ensureWptStreams(opts.fetch)

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
  logger.info(`WPT ref: ${ref.slice(0, 8)}`)
  if (opts.filter) {
    logger.info(`Filter: ${opts.filter}`)
  }
  logger.log('')

  // Run tests
  let totalPassed = 0
  let totalFailed = 0
  let totalTests = 0
  let filesWithFailures = 0

  // Track failures against expected list
  const expectedFailureKeys = new Set(EXPECTED_FAILURES.keys())
  const matchedExpected = new Set<string>()
  const unexpectedFailures: UnexpectedFailure[] = []

  for (let i = 0, { length } = testFiles; i < length; i += 1) {
    const testFile = testFiles[i]
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

    // Check if failures are expected
    const fileKey = result.file
    const isFileExpected = EXPECTED_FAILURES.has(fileKey)

    if (result.failed > 0) {
      filesWithFailures++

      // Check each error against expected failures
      // oxlint-disable-next-line socket/prefer-cached-for-loop -- iterable is not a bare identifier (could be Map/Set/Generator/expression)
      for (const err of result.errors) {
        // Extract test name from error (format: "testName: error message")
        const colonIdx = err.indexOf(':')
        const testName = colonIdx > 0 ? err.slice(0, colonIdx) : err
        const fullKey = `${fileKey}:${testName}`

        // Check for exact match or prefix match (some expected keys are prefixes)
        let matched = false
        if (EXPECTED_FAILURES.has(fullKey)) {
          matchedExpected.add(fullKey)
          matched = true
        } else if (isFileExpected) {
          matchedExpected.add(fileKey)
          matched = true
        } else {
          // Try prefix matching - expected failure key may be a prefix of actual test name
          // oxlint-disable-next-line socket/prefer-cached-for-loop -- loop variable is destructured
          for (const [expKey] of EXPECTED_FAILURES) {
            if (
              expKey.startsWith(`${fileKey}:`) &&
              fullKey.startsWith(expKey)
            ) {
              matchedExpected.add(expKey)
              matched = true
              break
            }
          }
        }
        if (!matched) {
          unexpectedFailures.push({ file: fileKey, test: testName, error: err })
        }
      }
    }

    // Status: green checkmark, yellow tilde (expected fail), red X (unexpected fail)
    let status
    if (result.failed === 0) {
      // oxlint-disable-next-line socket/no-status-emoji -- WPT validator emits ANSI-colored status markers ("\x1b[32m✓\x1b[0m" etc.) in column-aligned table rows; logger.success() would lose the colorization required by the WPT result format.
      status = '\x1b[32m✓\x1b[0m'
    } else {
      // Check if all failures in this file are expected
      const allExpected = result.errors.every(err => {
        const colonIdx = err.indexOf(':')
        const testName = colonIdx > 0 ? err.slice(0, colonIdx) : err
        const fullKey = `${fileKey}:${testName}`
        return EXPECTED_FAILURES.has(fullKey) || EXPECTED_FAILURES.has(fileKey)
      })
      // oxlint-disable-next-line socket/no-status-emoji -- WPT validator emits ANSI-colored status markers ("\x1b[32m✓\x1b[0m" etc.) in column-aligned table rows; logger.success() would lose the colorization required by the WPT result format.
      status = allExpected ? '\x1b[33m~\x1b[0m' : '\x1b[31m✗\x1b[0m'
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

  // Find expected failures that now pass (improvements).
  // `expectedFailureKeys` is a Set — use for...of.
  const nowPassing: string[] = []
  for (const key of expectedFailureKeys) {
    if (!matchedExpected.has(key)) {
      nowPassing.push(key)
    }
  }

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
