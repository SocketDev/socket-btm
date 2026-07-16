#!/usr/bin/env node
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

import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { fileURLToPath } from 'node:url'

import { getCurrentPlatformArch } from 'build-infra/lib/platform-mappings'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { errorMessage } from 'build-infra/lib/error-utils'

import { loadAllowlist } from './wpt-streams/allowlist.mts'
import type { TestResult } from './wpt-streams/types.mts'

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
export const WPT_SUBMODULE_DIR = path.join(
  PACKAGE_ROOT,
  'test',
  'fixtures',
  'wpt',
  'streams',
)
export const WPT_DIR = path.join(WPT_SUBMODULE_DIR, 'streams')

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
export const EXPECTED_FAILURES = loadAllowlist(ALLOWLIST_PATH)

// Files to skip (IDL tests, GC tests, platform-specific)
export const SKIP_FILES = new Set([
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
  // Drain one macrotask so late rejectionHandled events can retract entries,
  // then fold any still-unhandled rejections into one synthetic failure —
  // without the harness's unhandledRejection trap they would crash the
  // process before this JSON line ever printed.
  await new Promise(resolve => setTimeout(resolve, 0))
  let total = __tests.length
  if (self.__wptUnhandled && self.__wptUnhandled.length > 0) {
    failed++
    total++
    errors.push('(unhandled rejection) ' + self.__wptUnhandled.map(r => r?.message ?? String(r)).join(' | '))
  }
  process.stdout.write(JSON.stringify({ file: __WPT_REL_PATH, passed, failed, total, errors }) + '\\n')
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
  const lines = content.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
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
  // Wrap the test body in an IIFE so its directive prologue stays effective:
  // concatenated mid-program, a leading 'use strict' is an inert string
  // expression and the whole composed script runs sloppy — real WPT runs each
  // .any.js as its own classic script with its own strictness (the
  // strategy.size-as-method subtests depend on `this === undefined`). META
  // scripts stay top-level; their helpers must remain globally visible.
  parts.push(`;(function () {\n${content}\n})();`, RUN_EPILOGUE)
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
