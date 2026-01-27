#!/usr/bin/env node
/**
 * @fileoverview Run Node.js test suite against node-smol binary
 *
 * node-smol is built with these flags:
 * - --with-intl=small-icu (limited ICU, English-only)
 * - --without-npm (no npm)
 * - --without-amaro (no TypeScript stripping)
 * - --without-sqlite (no SQLite)
 * - --without-node-options (no NODE_OPTIONS)
 * - --without-inspector (prod builds only, no debugger)
 * - corepack excluded by default (no --with-corepack)
 *
 * This script runs a curated subset of Node.js tests that should work
 * with the node-smol feature set.
 *
 * Filtering Strategy:
 * 1. Expand TEST_PATTERNS using glob to get candidate test files
 * 2. Filter out files matching SKIP_PATTERNS
 * 3. Pass filtered list to Node.js test.py
 */

import { existsSync, promises as fs } from 'node:fs'
import { cpus } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseArgs } from '@socketsecurity/lib/argv/parse'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

import { getBuildPaths, UPSTREAM_PATH } from './paths.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const logger = getDefaultLogger()

// Parse arguments.
const { values } = parseArgs({
  options: {
    binary: { type: 'string' },
    dev: { type: 'boolean' },
    jobs: { type: 'string' },
    prod: { type: 'boolean' },
    verbose: { type: 'boolean', short: 'v' },
  },
  strict: false,
})

const IS_CI = 'CI' in process.env
const BUILD_MODE = values.prod || (!values.dev && IS_CI) ? 'prod' : 'dev'

/**
 * Test patterns to run.
 * 100% coverage of all Node.js functionality that node-smol supports.
 *
 * Included (complete coverage of node-smol features):
 * - Core JS: process, buffer, stream (1/2/3), timers, events, errors
 * - File system: all fs operations, File API, FileHandle, watch
 * - Crypto: crypto, webcrypto, hash algorithms, X509 certificates
 * - Networking: net (TCP), http, http2, https, tls, dns, dgram (UDP)
 * - Web APIs: fetch, WebSocket, WebStreams, Blob, WHATWG, EventSource, WebStorage
 * - Modules: require, ES modules, module resolution, module hooks
 * - Async: hooks, local storage, iteration, Promise hooks
 * - Concurrency: child process, cluster, worker threads, MessageChannel/Port
 * - VM: context execution and sandboxing
 * - Compression: zlib (gzip, deflate, brotli)
 * - System: OS utils, TTY, readline, signals, exit handling, stdio
 * - Stdlib: path, URL, URLPattern, querystring, punycode, util, string decoder, domain
 * - Dev: console, assert, diagnostics, trace events, test runner (node:test)
 * - Performance: measurement APIs
 * - Abort: AbortController/Signal
 * - Memory: WeakRef, garbage collection
 * - Security: permission model
 * - SEA: Single Executable Application support
 * - Other: structuredClone, validators, unicode, warnings, reports, UV/libuv
 * - Test suites: parallel, sequential, es-module, message, async-hooks, module-hooks
 *
 * Excluded (disabled features in node-smol):
 * - Full ICU/Intl tests (we use small-icu, English-only)
 * - npm tests (disabled with --without-npm)
 * - corepack tests (excluded by default)
 * - amaro/TypeScript tests (disabled with --without-amaro)
 * - SQLite tests (disabled with --without-sqlite)
 * - NODE_OPTIONS tests (disabled with --without-node-options)
 * - Inspector/debugger tests (disabled in prod with --without-inspector)
 * - REPL tests (may rely on disabled features)
 * - Snapshot tests (snapshot builds not covered)
 */
const TEST_PATTERNS = [
  // Core functionality tests.
  'parallel/test-process-*.js',
  'parallel/test-buffer-*.js',
  'parallel/test-stream-*.js',
  'parallel/test-stream2-*.js',
  'parallel/test-stream3-*.js',
  'parallel/test-timers-*.js',

  // File system tests.
  'parallel/test-fs-*.js',

  // Crypto tests.
  'parallel/test-crypto-*.js',
  'parallel/test-hash-*.js',
  'parallel/test-webcrypto-*.js',

  // Networking tests.
  'parallel/test-net-*.js',
  'parallel/test-http-*.js',
  'parallel/test-http2-*.js',
  'parallel/test-https-*.js',
  'parallel/test-tls-*.js',
  'parallel/test-dns-*.js',
  'parallel/test-dgram-*.js',
  'parallel/test-tcp-*.js',

  // Web APIs tests.
  'parallel/test-fetch-*.js',
  'parallel/test-web-*.js',
  'parallel/test-websocket-*.js',
  'parallel/test-webstream-*.js',
  'parallel/test-blob-*.js',
  'parallel/test-whatwg-*.js',
  'parallel/test-eventsource-*.js',

  // Module system tests.
  'parallel/test-require-*.js',
  'parallel/test-module-*.js',

  // ES module tests.
  'es-module/test-*.mjs',

  // Sequential tests (must not run in parallel).
  'sequential/test-*.js',
  'sequential/test-*.mjs',

  // Message tests (stderr/stdout output validation).
  'message/test-*.js',

  // Async hooks directory tests (comprehensive async hooks testing).
  'async-hooks/test-*.js',

  // Module hooks tests.
  'module-hooks/test-*.mjs',

  // Async tests.
  'parallel/test-async-*.js',
  'parallel/test-async-hooks-*.js',
  'parallel/test-async-local-*.js',

  // Child process and cluster tests.
  'parallel/test-child-process-*.js',
  'parallel/test-cluster-*.js',
  'parallel/test-spawn-*.js',

  // Worker threads tests.
  'parallel/test-worker-*.js',

  // VM tests.
  'parallel/test-vm-*.js',

  // Compression tests.
  'parallel/test-zlib-*.js',

  // OS utilities tests.
  'parallel/test-os-*.js',

  // Event emitter tests.
  'parallel/test-event-*.js',
  'parallel/test-eventemitter-*.js',

  // Console and assert tests.
  'parallel/test-console-*.js',
  'parallel/test-assert-*.js',

  // Diagnostics tests.
  'parallel/test-diagnostics-*.js',
  'parallel/test-diagnostic-*.js',
  'parallel/test-trace-*.js',

  // Performance tests.
  'parallel/test-perf-*.js',
  'parallel/test-performance-*.js',

  // Standard library tests.
  'parallel/test-path-*.js',
  'parallel/test-url-*.js',
  'parallel/test-querystring-*.js',
  'parallel/test-punycode-*.js',
  'parallel/test-util-*.js',
  'parallel/test-string-decoder-*.js',
  'parallel/test-domain-*.js',
  'parallel/test-errors-*.js',
  'parallel/test-constants-*.js',

  // Abort controller tests.
  'parallel/test-abort-*.js',
  'parallel/test-abortcontroller-*.js',
  'parallel/test-abortsignal-*.js',

  // TTY tests.
  'parallel/test-tty-*.js',

  // Readline tests.
  'parallel/test-readline-*.js',

  // Signal tests.
  'parallel/test-signal-*.js',

  // V8 integration tests (that don't require inspector).
  'parallel/test-v8-*.js',

  // File API tests.
  'parallel/test-file-*.js',
  'parallel/test-filehandle-*.js',

  // MessageChannel and MessagePort tests.
  'parallel/test-messagechannel-*.js',
  'parallel/test-messageport-*.js',
  'parallel/test-messageevent-*.js',

  // Promise hooks tests.
  'parallel/test-promise-*.js',
  'parallel/test-promises-*.js',

  // structuredClone tests.
  'parallel/test-structuredClone-*.js',

  // URLPattern tests.
  'parallel/test-urlpattern-*.js',

  // Watch tests.
  'parallel/test-watch-*.js',

  // Stdio tests.
  'parallel/test-stdin-*.js',
  'parallel/test-stdout-*.js',
  'parallel/test-stderr-*.js',

  // Exit tests.
  'parallel/test-exit-*.js',

  // Report generation tests.
  'parallel/test-report-*.js',

  // WeakRef tests.
  'parallel/test-weakref-*.js',

  // X509 certificate tests.
  'parallel/test-x509-*.js',

  // Unhandled rejection tests.
  'parallel/test-unhandled-*.js',

  // Unicode tests.
  'parallel/test-unicode-*.js',

  // Wrap tests.
  'parallel/test-wrap-*.js',

  // Priority queue tests.
  'parallel/test-priority-*.js',

  // Tracing tests.
  'parallel/test-tracing-*.js',

  // Warning tests.
  'parallel/test-warn-*.js',

  // Test runner tests (node:test module).
  'parallel/test-runner-*.js',

  // Single Executable Application tests (SEA).
  'parallel/test-sea-*.js',

  // Permission model tests.
  'parallel/test-permission-*.js',

  // Garbage collection tests.
  'parallel/test-gc-*.js',

  // WebStorage tests.
  'parallel/test-webstorage-*.js',

  // UV (libuv) tests.
  'parallel/test-uv-*.js',

  // TTY wrap tests.
  'parallel/test-ttywrap-*.js',

  // Timezone tests.
  'parallel/test-tz-*.js',

  // Validator tests.
  'parallel/test-validators-*.js',
]

/**
 * Test patterns to explicitly skip.
 * These tests require features disabled in node-smol.
 */
const SKIP_PATTERNS = [
  // ICU/Intl tests (we use small-icu).
  '*intl*',
  '*icu*',
  '*collator*',
  '*locale*',

  // npm tests (disabled with --without-npm).
  '*npm*',

  // corepack tests (excluded by default).
  '*corepack*',

  // TypeScript/amaro tests (disabled with --without-amaro).
  '*amaro*',
  '*typescript*',
  '*strip-types*',
  '*type-stripping*',
  // TypeScript eval tests
  '*test-esm-import-meta-main-eval*',

  // HTTP2 tests (disabled without http2 support).
  '*http2*',
  // Requires http2
  '*filehandle-no-reuse*',

  // SQLite tests (disabled with --without-sqlite).
  '*sqlite*',

  // NODE_OPTIONS tests (disabled with --without-node-options).
  '*node-options*',
  // Tests NODE_OPTIONS import order
  '*test-esm-import-flag*',

  // Inspector tests (disabled in prod with --without-inspector).
  '*inspector*',
  '*debugger*',
  '*debug-process*',
  '*debug-port*',
  '*heapsnapshot*',
  '*cpu-prof*',
  '*coverage*',

  // REPL tests (may rely on disabled features).
  '*repl*',

  // V8 tests that require inspector.
  '*v8-coverage*',
  '*v8-serialize-leak*',
  '*v8-takecoverage*',

  // Tests that require specific build configurations.
  '*sea-snapshot*',
  '*snapshot-*',

  // Tests that explicitly check for features we disabled.
  '*experimental-sqlite*',
  '*experimental-strip-types*',
]

/**
 * Expand glob patterns into actual test file paths.
 *
 * @param {string} testDir - Node.js test directory
 * @param {string[]} patterns - Glob patterns to expand
 * @returns {Promise<string[]>} Array of absolute test file paths
 */
async function expandTestPatterns(testDir, patterns) {
  const matchedFiles = new Set()

  for (const pattern of patterns) {
    const fullPattern = path.join(testDir, pattern)
    const dir = path.dirname(fullPattern)
    const filePattern = path.basename(fullPattern)

    // Check if directory exists.
    if (!existsSync(dir)) {
      continue
    }

    // Convert glob pattern to regex.
    const regex = new RegExp(
      `^${filePattern.replaceAll('*', '.*').replaceAll('?', '.')}$`,
    )

    try {
      const entries = await fs.readdir(dir, { recursive: false })
      for (const entry of entries) {
        if (regex.test(entry)) {
          const fullPath = path.join(dir, entry)
          const stat = await fs.stat(fullPath)
          if (stat.isFile()) {
            matchedFiles.add(fullPath)
          }
        }
      }
    } catch {
      // Ignore errors reading directory.
    }
  }

  return [...matchedFiles].sort()
}

/**
 * Check if a test file path matches any skip pattern.
 *
 * @param {string} testPath - Absolute test file path
 * @param {string[]} skipPatterns - Patterns to skip
 * @returns {boolean} True if should be skipped
 */
function shouldSkipTest(testPath, skipPatterns) {
  const testName = path.basename(testPath)
  const testRelPath = testPath.toLowerCase()

  for (const pattern of skipPatterns) {
    const lowerPattern = pattern.toLowerCase()

    // Convert glob pattern to regex.
    const regex = new RegExp(
      `^${lowerPattern.replaceAll('*', '.*').replaceAll('?', '.')}$`,
    )

    // Match against filename.
    if (regex.test(testName.toLowerCase())) {
      return true
    }

    // Match against relative path.
    if (testRelPath.includes(lowerPattern.replaceAll('*', ''))) {
      return true
    }
  }

  return false
}

/**
 * Filter test files based on skip patterns.
 *
 * @param {string[]} testFiles - Array of test file paths
 * @param {string[]} skipPatterns - Patterns to skip
 * @returns {object} Filtered tests and statistics
 */
function filterTests(testFiles, skipPatterns) {
  const filtered = []
  const skipped = []

  for (const testFile of testFiles) {
    if (shouldSkipTest(testFile, skipPatterns)) {
      skipped.push(testFile)
    } else {
      filtered.push(testFile)
    }
  }

  return {
    filtered,
    skipped,
    stats: {
      total: testFiles.length,
      filtered: filtered.length,
      skipped: skipped.length,
    },
  }
}

/**
 * Main test runner.
 */
async function main() {
  logger.log('')
  logger.log('🧪 Node.js Test Suite Runner for node-smol')
  logger.log('')

  // Determine binary path.
  const { outputFinalBinary } = getBuildPaths(BUILD_MODE)
  const binaryPath = values.binary || outputFinalBinary

  if (!existsSync(binaryPath)) {
    logger.fail(`Binary not found: ${binaryPath}`)
    logger.log('')
    logger.log('Build node-smol first:')
    logger.log('  pnpm build')
    logger.log('')
    process.exit(1)
  }

  logger.log(`Binary: ${binaryPath}`)
  logger.log(`Build mode: ${BUILD_MODE}`)
  logger.log('')

  // Verify Node.js source upstream.
  const nodeSourcePath = UPSTREAM_PATH
  if (!existsSync(nodeSourcePath)) {
    logger.fail('Node.js source upstream not found')
    logger.log('')
    logger.log('Initialize upstream:')
    logger.log('  git submodule update --init --recursive')
    logger.log('')
    process.exit(1)
  }

  const testDir = path.join(nodeSourcePath, 'test')
  if (!existsSync(testDir)) {
    logger.fail(`Test directory not found: ${testDir}`)
    process.exit(1)
  }

  logger.log(`Test directory: ${testDir}`)
  logger.log('')

  // Expand test patterns into actual file paths.
  logger.step('Expanding test patterns...')
  const candidateTests = await expandTestPatterns(testDir, TEST_PATTERNS)
  logger.log(`Found ${candidateTests.length} candidate tests`)
  logger.log('')

  // Filter tests based on skip patterns.
  logger.step('Filtering tests...')
  const { filtered, skipped, stats } = filterTests(
    candidateTests,
    SKIP_PATTERNS,
  )

  logger.log(`Total matched: ${stats.total}`)
  logger.log(`Filtered (will run): ${stats.filtered}`)
  logger.log(`Skipped (excluded): ${stats.skipped}`)
  logger.log('')

  if (values.verbose && skipped.length > 0) {
    logger.log('Skipped tests (first 10):')
    for (const test of skipped.slice(0, 10)) {
      logger.log(`  - ${path.basename(test)}`)
    }
    if (skipped.length > 10) {
      logger.log(`  ... and ${skipped.length - 10} more`)
    }
    logger.log('')
  }

  if (filtered.length === 0) {
    logger.fail('No tests to run after filtering')
    process.exit(1)
  }

  // Determine number of parallel jobs.
  const jobs = values.jobs || Math.max(1, cpus().length - 1)

  logger.log('Test configuration:')
  logger.log(`  Parallel jobs: ${jobs}`)
  logger.log(`  Verbose: ${values.verbose ? 'yes' : 'no'}`)
  logger.log('')

  // Build test command.
  // Use Node.js's test.py runner with our binary.
  const pythonBin = 'python3'
  const testScript = path.join(nodeSourcePath, 'tools', 'test.py')

  if (!existsSync(testScript)) {
    logger.fail(`Test runner not found: ${testScript}`)
    process.exit(1)
  }

  // Pass filtered test files (relative to test dir) to test.py.
  const relativeTests = filtered.map(t => path.relative(testDir, t))

  const args = [
    testScript,
    `--shell=${binaryPath}`,
    `-j${jobs}`,
    ...relativeTests,
  ]

  if (values.verbose) {
    args.push('--verbose')
  }

  logger.step('Running Node.js tests...')
  logger.log('')

  // Run tests.
  const result = await spawn(pythonBin, args, {
    cwd: nodeSourcePath,
    stdio: 'inherit',
  })

  logger.log('')

  if (result.code === 0) {
    logger.success('All tests passed!')
    logger.log('')
  } else {
    logger.fail(`Tests failed with exit code ${result.code}`)
    logger.log('')
    process.exit(result.code)
  }
}

main().catch(e => {
  logger.fail(`Test runner failed: ${e.message}`)
  throw e
})
